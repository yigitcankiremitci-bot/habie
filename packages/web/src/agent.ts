import { db } from './db';

/**
 * Ajan istemcisi.
 *
 * Ajan sohbeti Habie'nin zarf protokolünden BİLEREK geçmez — tarayıcı doğrudan
 * host uygulamanın API'sine konuşur. Sebebi mimari dokümanda: ajanın okuyacağı
 * içerik zaten sunucuda işlenmek zorunda, dolayısıyla Habie'nin transit kuyruğuna
 * sokmanın hiçbir faydası yok, üstelik geçmişin sahibi host uygulama.
 *
 * Yani bu dosya Habie gateway'ini hiç kullanmıyor.
 */

export type AgentConfig = {
  /** Host uygulama kimliği — 'projelio' */
  id: string;
  /** Kullanıcıya görünen ad — 'Lio' */
  name: string;
  /** https://projelio-backend.onrender.com */
  baseUrl: string;
  chatPath: string;      // /ai/chat
  confirmPath: string;   // /ai/confirm
  token: string;         // kısa ömürlü host uygulama JWT'si
};

export type AgentReply =
  | { kind: 'message'; text: string; conversationId?: string; balance?: number }
  | {
      kind: 'confirmation';
      actionId: string;
      summary: string;
      toolName: string;
      text?: string;
      conversationId?: string;
      balance?: number;
    };

/** Ajan sohbeti gerçek bir Habie sohbeti değil — kimliği istemcide üretiliyor. */
export const agentConversationId = (agentId: string) => `agent:${agentId}`;

export class AgentClient {
  constructor(private cfg: AgentConfig) {}

  get name() { return this.cfg.name; }
  get id() { return this.cfg.id; }
  get conversationId() { return agentConversationId(this.cfg.id); }

  private async post(path: string, body: unknown): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.token}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // CORS reddi de ağ hatası gibi görünür — en sık sebep bu.
      throw new Error(
        `${this.cfg.name} sunucusuna ulaşılamadı. Ağ bağlantısını ve sunucudaki CORS ayarını kontrol et.`
      );
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error(`${this.cfg.name} oturumu doldu. Sayfayı yenile.`);
      }
      // Host uygulama hataları Türkçe mesajla geliyor — olduğu gibi göster.
      throw new Error(data?.message ?? data?.error ?? `${this.cfg.name} hata verdi (${res.status}).`);
    }
    return data;
  }

  private normalize(data: any): AgentReply {
    const balance = data?.usage?.balance;
    if (data?.type === 'confirmation') {
      return {
        kind: 'confirmation',
        actionId: data.actionId,
        summary: data.summary,
        toolName: data.toolName,
        text: data.text,
        conversationId: data.conversationId,
        balance,
      };
    }
    return {
      kind: 'message',
      text: data?.text ?? '',
      conversationId: data?.conversationId,
      balance,
    };
  }

  /** Host uygulamanın sohbet kimliğini sakla — geçmiş orada tutuluyor. */
  private convKey() { return `agentConv:${this.cfg.id}`; }

  async chat(message: string): Promise<AgentReply> {
    const conversationId = await db.get<string | null>(this.convKey(), null);
    const data = await this.post(this.cfg.chatPath, {
      message,
      ...(conversationId ? { conversationId } : {}),
    });
    const reply = this.normalize(data);
    if (reply.conversationId) await db.set(this.convKey(), reply.conversationId);
    return reply;
  }

  /**
   * Kritik araçlar (silme, bütçe girişi) için onay.
   *
   * DİKKAT: host uygulama bekleyen işlemi BELLEKTE tutuyor, 10 dakika ömürlü ve
   * tek instance'a bağlı. Gecikirse ya da sunucu yeniden başlarsa onay kaybolur.
   */
  async confirm(actionId: string, confirmed: boolean): Promise<AgentReply> {
    return this.normalize(await this.post(this.cfg.confirmPath, { actionId, confirmed }));
  }
}

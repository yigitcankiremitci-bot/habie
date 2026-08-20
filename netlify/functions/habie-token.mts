import type { Context } from '@netlify/functions';
import jwt from 'jsonwebtoken';

/**
 * HOST UYGULAMANIN BACKEND'İ.
 *
 * Gerçek hayatta bu kod Projelio'nun kendi sunucusunda yaşar ve giriş yapmış
 * kullanıcı için iddia üretir. Burada Netlify Function olarak duruyor çünkü
 * demo host uygulamasının backend'i tam olarak burası.
 *
 * Kritik nokta: uygulamanın jwt_secret'ı ASLA tarayıcıya inmez.
 * Tarayıcı yalnızca 5 dakikalık imzalı iddiayı görür.
 *
 * Üretimde `sub` değeri kendi oturumundan gelir (çerez / Supabase session),
 * query parametresinden DEĞİL. Aşağıdaki persona seçimi sadece demo içindir.
 */

const PERSONAS: Record<string, { appId: string; sub: string; name: string; workspaceId: string | null }> = {
  '0': { appId: 'projelio', sub: 'usr_8812', name: 'Ayşe Yılmaz',   workspaceId: 'org_acme' },
  '1': { appId: 'projelio', sub: 'usr_9930', name: 'Zeynep Arslan', workspaceId: 'org_acme' },
  '2': { appId: 'stokla',   sub: 'u-441',    name: 'Ahmet Korkmaz', workspaceId: null },
};

export default async (req: Request, _ctx: Context) => {
  const as = new URL(req.url).searchParams.get('as') ?? '0';
  const p = PERSONAS[as] ?? PERSONAS['0'];

  // APP_SECRETS, gateway'dekiyle AYNI değer olmalı.
  const secrets = JSON.parse(process.env.APP_SECRETS ?? '{}') as Record<string, string>;
  const secret = secrets[p.appId];

  if (!secret) {
    return Response.json(
      { error: `APP_SECRETS içinde "${p.appId}" yok. Netlify ortam değişkenlerini kontrol et.` },
      { status: 500 }
    );
  }

  const assertion = jwt.sign(
    {
      iss: p.appId,
      sub: p.sub,
      name: p.name,
      workspace_id: p.workspaceId,
      role: 'member',
    },
    secret,
    { expiresIn: '5m' }
  );

  return Response.json(
    { assertion, persona: { name: p.name, appId: p.appId } },
    { headers: { 'cache-control': 'no-store' } }
  );
};

export const config = { path: '/api/habie-token' };

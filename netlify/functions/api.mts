import type { Config, Context } from "@netlify/functions";
import { createApp } from "../../src/server/app";
import { NeonStore } from "../../src/server/store";

let app: ReturnType<typeof createApp> | undefined;
export default async (request: Request, context: Context) => {
  if(!app) {
    const databaseUrl=Netlify.env.get('DATABASE_URL');
    if(!databaseUrl) return Response.json({error:'Configure DATABASE_URL and apply db/migrations/001_dock.sql to activate event storage.'},{status:503,headers:{'Cache-Control':'no-store'}});
    app=createApp(new NeonStore(databaseUrl),{
      adminPasswordHash:Netlify.env.get('ADMIN_PASSWORD_HASH'),eventCode:Netlify.env.get('EVENT_CODE'),
      siteUrl:Netlify.env.get('SITE_URL') || context.site.url,
    });
  }
  return app(request,context.ip);
};
export const config: Config = {path:'/api/*'};

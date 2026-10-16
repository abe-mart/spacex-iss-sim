import type { Config, Context } from "@netlify/functions";
import { createApp } from "../../src/server/app";
import { NeonStore } from "../../src/server/store";
import { anthropicCapcom } from "../../src/server/capcom";

let app: ReturnType<typeof createApp> | undefined;
export default async (request: Request, context: Context) => {
  if(!app) {
    const databaseUrl=Netlify.env.get('DATABASE_URL');
    if(!databaseUrl) return Response.json({error:'Configure DATABASE_URL and apply db/migrations/001_dock.sql to activate event storage.'},{status:503,headers:{'Cache-Control':'no-store'}});
    // The Netlify project stores the key as ANTHROPIC_KEY; ANTHROPIC_API_KEY is the SDK's conventional name.
    const anthropicKey=Netlify.env.get('ANTHROPIC_API_KEY') || Netlify.env.get('ANTHROPIC_KEY');
    app=createApp(new NeonStore(databaseUrl),{
      adminPasswordHash:Netlify.env.get('ADMIN_PASSWORD_HASH'),eventCode:Netlify.env.get('EVENT_CODE'),
      siteUrl:Netlify.env.get('SITE_URL') || context.site.url,
      sitePasswordHash:Netlify.env.get('SITE_PASSWORD_HASH'),
      capcom:anthropicKey?anthropicCapcom(anthropicKey):undefined,
      dailyBudgetUsd:Number(Netlify.env.get('DAILY_BUDGET_USD')) || undefined,
    });
  }
  return app(request,context.ip);
};
export const config: Config = {path:'/api/*'};

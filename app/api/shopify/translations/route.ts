import { db, jsonError } from "@/app/lib/server-db";
import { decryptSecret } from "@/app/lib/secrets";
import { requireWorkspace } from "@/app/lib/workspace";

export const maxDuration=300;
async function graph(domain:string,version:string,token:string,query:string,variables:Record<string,unknown>){
 const response=await fetch(`https://${domain}/admin/api/${version}/graphql.json`,{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":token},body:JSON.stringify({query,variables})});
 const payload=await response.json(); if(!response.ok||payload.errors?.length)throw new Error(payload.errors?.[0]?.message||"Shopify translation failed"); return payload.data;
}
export async function POST(request:Request){
 try{
  const auth=await requireWorkspace(request); if(!auth.context)return auth.response;
  const body=await request.json().catch(()=>({})); const locale=String(body.locale||"en"); const ids=Array.isArray(body.product_ids)?body.product_ids.slice(0,100).map(String):[];
  const sql=db(); const integrations=await sql`SELECT store_domain,access_token_encrypted,api_version FROM workspace_shopify_integrations WHERE workspace_id=${auth.context.workspace.id}::uuid`; if(!integrations[0])return Response.json({error:"Connect Shopify first"},{status:400});
  const rows=ids.length?await sql`SELECT translation.*,product.shopify_product_id FROM product_translations translation JOIN products product ON product.id=translation.product_id WHERE translation.workspace_id=${auth.context.workspace.id}::uuid AND translation.locale=${locale} AND translation.status='ready' AND translation.product_id=ANY(${ids}::uuid[]) AND product.shopify_product_id IS NOT NULL`:await sql`SELECT translation.*,product.shopify_product_id FROM product_translations translation JOIN products product ON product.id=translation.product_id WHERE translation.workspace_id=${auth.context.workspace.id}::uuid AND translation.locale=${locale} AND translation.status='ready' AND product.shopify_product_id IS NOT NULL LIMIT 100`;
  const integration=integrations[0],token=await decryptSecret(String(integration.access_token_encrypted)); let published=0; const failed:Array<{id:string;error:string}>=[];
  for(const row of rows){try{
   const content=await graph(String(integration.store_domain),String(integration.api_version),token,`query Content($id:ID!){translatableResource(resourceId:$id){translatableContent{key digest}}}`,{id:row.shopify_product_id});
   const digests=new Map((content.translatableResource?.translatableContent||[]).map((item:{key:string;digest:string})=>[item.key,item.digest]));
   const items=[{key:"title",value:String(row.title||""),locale,translatableContentDigest:digests.get("title")},{key:"body_html",value:String(row.body_html||""),locale,translatableContentDigest:digests.get("body_html")}].filter(item=>item.value&&item.translatableContentDigest);
   const result=await graph(String(integration.store_domain),String(integration.api_version),token,`mutation Register($id:ID!,$translations:[TranslationInput!]!){translationsRegister(resourceId:$id,translations:$translations){userErrors{field message}}}`,{id:row.shopify_product_id,translations:items});
   const errors=result.translationsRegister?.userErrors||[]; if(errors.length)throw new Error(errors.map((e:{message:string})=>e.message).join("; "));
   await sql`UPDATE product_translations SET status='published',updated_at=now() WHERE id=${row.id}::uuid`; published++;
  }catch(error){const message=error instanceof Error?error.message:"Translation failed";failed.push({id:String(row.id),error:message});await sql`UPDATE product_translations SET status='failed',updated_at=now() WHERE id=${row.id}::uuid`;}}
  return Response.json({published,failed});
 }catch(error){return jsonError(error);}
}


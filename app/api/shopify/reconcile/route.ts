import { db, jsonError } from "@/app/lib/server-db";
import { decryptSecret } from "@/app/lib/secrets";
import { requireWorkspace } from "@/app/lib/workspace";

export const maxDuration = 300;

async function graph(domain:string, version:string, token:string, query:string, variables:Record<string,unknown>) {
  const response=await fetch(`https://${domain}/admin/api/${version}/graphql.json`,{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":token},body:JSON.stringify({query,variables})});
  const payload=await response.json();
  if(!response.ok||payload.errors?.length) throw new Error(payload.errors?.[0]?.message||"Shopify reconciliation failed");
  return payload.data;
}

export async function POST(request:Request){
  try{
    const auth=await requireWorkspace(request); if(!auth.context)return auth.response;
    const payload=await request.json().catch(()=>({}));
    const ids=Array.isArray(payload.product_ids)?payload.product_ids.slice(0,100).map(String):[];
    const sql=db();
    const integrations=await sql`SELECT store_domain,access_token_encrypted,api_version FROM workspace_shopify_integrations WHERE workspace_id=${auth.context.workspace.id}::uuid`;
    if(!integrations[0])return Response.json({error:"Connect Shopify first"},{status:400});
    const products=ids.length
      ? await sql`SELECT id,title,vendor,category,body_html,sale_price,shopify_product_id FROM products WHERE workspace_id=${auth.context.workspace.id}::uuid AND id=ANY(${ids}::uuid[]) AND shopify_product_id IS NOT NULL`
      : await sql`SELECT id,title,vendor,category,body_html,sale_price,shopify_product_id FROM products WHERE workspace_id=${auth.context.workspace.id}::uuid AND shopify_product_id IS NOT NULL ORDER BY updated_at DESC LIMIT 100`;
    if(!products.length)return Response.json({checked:0,changes:0});
    const integration=integrations[0]; const token=await decryptSecret(String(integration.access_token_encrypted));
    const data=await graph(String(integration.store_domain),String(integration.api_version),token,`query Reconcile($ids:[ID!]!){nodes(ids:$ids){... on Product{id title descriptionHtml vendor productType status updatedAt variants(first:1){nodes{price inventoryQuantity}}}}}`,{ids:products.map(p=>p.shopify_product_id)});
    const remoteById = new Map<string, Record<string, unknown>>((data.nodes || []).filter(Boolean).map((node: Record<string, unknown>) => [String(node.id), node] as [string, Record<string, unknown>]));
    let changes=0;
    for(const product of products){
      const remote=remoteById.get(String(product.shopify_product_id)); if(!remote)continue;
      const variants=remote.variants as {nodes?:Array<{price?:string;inventoryQuantity?:number}>}|undefined;
      const fields:Array<[string,unknown,unknown]>=[
        ["title",product.title,remote.title],["vendor",product.vendor,remote.vendor],
        ["category",product.category,remote.productType],["body_html",product.body_html,remote.descriptionHtml],
        ["sale_price",Number(product.sale_price||0),Number(variants?.nodes?.[0]?.price||0)],
      ];
      await sql`INSERT INTO product_versions(workspace_id,product_id,snapshot,source,actor) VALUES(${auth.context.workspace.id}::uuid,${product.id}::uuid,${JSON.stringify(remote)}::jsonb,'shopify_reconcile','Shopify')`;
      for(const [field,localValue,remoteValue] of fields){
        if(String(localValue??"")===String(remoteValue??""))continue;
        const rows=await sql`INSERT INTO catalog_changes(workspace_id,product_id,field,old_value,new_value,source,status)
          SELECT ${auth.context.workspace.id}::uuid,${product.id}::uuid,${field},${JSON.stringify(localValue)}::jsonb,${JSON.stringify(remoteValue)}::jsonb,'shopify','pending'
          WHERE NOT EXISTS(SELECT 1 FROM catalog_changes WHERE product_id=${product.id}::uuid AND field=${field} AND source='shopify' AND status='pending' AND new_value=${JSON.stringify(remoteValue)}::jsonb) RETURNING id`;
        changes+=rows.length;
      }
    }
    await sql`INSERT INTO operation_runs(workspace_id,kind,status,summary,completed_at) VALUES(${auth.context.workspace.id}::uuid,'shopify_reconcile','completed',${JSON.stringify({checked:products.length,changes})}::jsonb,now())`;
    return Response.json({checked:products.length,changes});
  }catch(error){return jsonError(error);}
}


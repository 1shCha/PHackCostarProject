import assert from "node:assert/strict";
import {test} from "node:test";
import {searchSpaces} from "./search";

test("ranked suite search uses remote candidates without a local database",async()=>{
 const saved={url:process.env.BACKEND_API_URL,key:process.env.BACKEND_API_KEY,path:process.env.DUCKDB_PATH};
 const original=globalThis.fetch;
 try{
  process.env.BACKEND_API_URL="https://backend.example/";
  process.env.BACKEND_API_KEY="synthetic-key";
  process.env.DUCKDB_PATH="/nonexistent/remote-search.duckdb";
  globalThis.fetch=async(input,options)=>{
   assert.equal(String(input),"https://backend.example/tools/search_candidates");
   assert.deepEqual(JSON.parse(String(options?.body)),{sqft_min:1500,sqft_max:2000,city:"Houston"});
   return Response.json([{suite_id:"a".repeat(64),suite:"900",city:"Houston",sqft:1800,building_name:"Fixture",
    street:"100 Main St",property_type:"GeneralRetail",model_ids:null,latitude:29,longitude:-95,
    asking:20,signed:18,n_signed:"2",past:[]}]);
  };
  const response=await searchSpaces("barber, 1500-2000 sq ft, Houston");
  assert.equal(response.total,1);assert.equal(response.results[0].suite,"Suite 900");
  assert.equal(response.results[0].asking_rent,20);assert.equal(response.results[0].badge,"Best match");
  globalThis.fetch=async()=>Response.json({},{status:503});
  await assert.rejects(searchSpaces("barber, 1500-2000 sq ft, Houston"),/HTTP 503/);
 }finally{
  globalThis.fetch=original;
  for(const[name,value]of [["BACKEND_API_URL",saved.url],["BACKEND_API_KEY",saved.key],["DUCKDB_PATH",saved.path]]as const){if(value===undefined)delete process.env[name];else process.env[name]=value;}
 }
});

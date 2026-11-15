import assert from "node:assert/strict";
import {searchSpaces} from "../src/lib/search";

async function main(){
 const url=process.env.BACKEND_API_URL,key=process.env.BACKEND_API_KEY,localPath=process.env.DUCKDB_PATH;
 assert.ok(url&&key&&localPath,"Configure remote URL/key and a local database for the parity check");
 for(const text of ["barber, 1500-2000 sq ft, Houston","dermatologist, 5000-7000 sq ft, Houston","law firm, 3k-4k sf, Houston"]){
  delete process.env.BACKEND_API_URL;delete process.env.BACKEND_API_KEY;process.env.DUCKDB_PATH=localPath;
  const local=await searchSpaces(text,10000);
  process.env.BACKEND_API_URL=url;process.env.BACKEND_API_KEY=key;process.env.DUCKDB_PATH="/nonexistent/remote-search.duckdb";
  const remote=await searchSpaces(text,10000);
  assert.equal(remote.total,local.total);
  const normalize=(result:typeof local)=>result.results.map(({badge,...row})=>{void badge;return row;}).sort((a,b)=>a.suite_id.localeCompare(b.suite_id));
  assert.deepEqual(normalize(remote),normalize(local));
  assert.deepEqual(remote.results.map(row=>row.score),local.results.map(row=>row.score));
  console.log(`Remote/local search parity passed: ${text}; ${remote.total} suites; local file disabled during remote calls.`);
 }
}
main().catch(()=>{console.error("Remote search parity failed; check the latest backend deployment and logs.");process.exitCode=1;});

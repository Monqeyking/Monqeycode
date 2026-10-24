const http=require('node:http'),https=require('node:https');
module.exports=function postJson(url,payload,headers,timeoutMs){
 return new Promise((resolve,reject)=>{
  const request=(new URL(url).protocol==='https:'?https:http).request(url,{method:'POST',headers,signal:AbortSignal.timeout(timeoutMs),agent:false},response=>{
   let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;if(body.length>16000000)response.destroy(Error('Live test response exceeded its bound.'));});
   response.on('error',reject);response.on('end',()=>{try{resolve(JSON.parse(body));}catch(error){reject(error);}});
  });request.on('error',reject);request.end(JSON.stringify(payload));
 });
};

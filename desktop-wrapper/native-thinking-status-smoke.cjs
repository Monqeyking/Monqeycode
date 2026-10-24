const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),home=fs.mkdtempSync(path.join(root,'logs/thinking-fixture-'));
const profileRequire=createRequire(path.join(root,'profiles/web/package.json'));
const client=fs.readFileSync(profileRequire.resolve('@deepseek-ai/dsh-client-ui-chat/client'),'utf8');
const selector=client.match(/function monqeyIsThinking\(snapshot\) \{[\s\S]*?\n\t\t\}/)?.[0];
const start=client.indexOf('function TurnStatus('),end=client.indexOf('\n\t\tconst ChatNodeList',start);
if(!selector||start<0||end<0)throw Error('The runtime did not resolve the Monqey native chat component.');
const status=client.slice(start,end);
app.setPath('userData',home);app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:false,nodeIntegration:true}});
 try{
  await win.loadURL('data:text/html,<html><body><div id="root"></div><p id="message">Deep diving... is ordinary conversation text.</p></body></html>');
  const checks=await win.webContents.executeJavaScript(`(async()=>{
   const react={useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect:()=>{}};
   const jsx=(type,props)=>{
    const element=document.createElement(type);
    for(const [key,value]of Object.entries(props)){
     if(key==='children')continue;
     if(key==='style'){for(const [name,setting]of Object.entries(value))element.style.setProperty(name,setting);}
     else if(value!==undefined&&value!==false)element.setAttribute(key==='className'?'class':key,String(value));
    }
    for(const child of [props.children].flat())if(child!==false&&child!==null&&child!==undefined)element.append(child instanceof Node?child:document.createTextNode(String(child)));
    return element;
   };
   const react_jsx_runtime={jsx,jsxs:jsx};
   const ChatView_module_css_default={turnStatus:'native-status',turnStatusClock:'native-clock'};
   const formatRunDuration=ms=>Math.floor(ms/1000)+'s';
   ${selector}
   ${status}
   const root=document.getElementById('root'),checks=[];
   const t=()=> 'Scratching head…',startTime=Date.now()-16000;
   const render=(phase,blocks,runningCalls=[],key=0)=>{
    const thinking=monqeyIsThinking({legacy:{partial:blocks===null?null:{blocks},runningCalls}});
    root.replaceChildren(...(thinking?[TurnStatus({startTime,t,key})]:[]));
    const element=document.querySelector('[role="status"]');
    if(Boolean(element)!==thinking)throw Error(phase+': wrong visibility');
    if(element){
     if(element.firstChild.nodeValue!=='Scratching head…')throw Error(phase+': native label reset');
     if(!element.style.getPropertyValue('--dsw-static-deepseek-500').includes('--monqey-thinking-base'))throw Error(phase+': wrong color');
     if(element.querySelector('.native-clock').textContent!=='16s')throw Error(phase+': timer changed');
    }
    checks.push(phase);
   };
   render('first-token wait',null);
   render('reasoning in a collapsed transcript',[{kind:'reasoning',text:'Plan'}]);
   render('tool call',[{kind:'tool-call'}],[{callId:'t'}]);
   render('answer stream',[{kind:'reasoning'},{kind:'text'}]);
   render('retry wait after reasoning',null);
   render('new reasoning attempt',[{kind:'reasoning'}],[],1);
   render('native status remount',[{kind:'reasoning'}],[],2);
   render('completed turn',null);
   if(document.getElementById('message').textContent!=='Deep diving... is ordinary conversation text.')throw Error('Conversation text changed');
   root.replaceChildren();checks.push('conversation text preserved');return checks;
  })()`);
  fs.writeFileSync(path.join(root,'logs/thinking-status-check.json'),JSON.stringify({ok:true,checks,fixtureHome:home,runtimeClient:profileRequire.resolve('@deepseek-ai/dsh-client-ui-chat/client')}));
  win.destroy();app.quit();
 }catch(error){fs.writeFileSync(path.join(root,'logs/thinking-status-check.json'),JSON.stringify({ok:false,error:error.stack,fixtureHome:home}));win.destroy();app.exit(1);}
});

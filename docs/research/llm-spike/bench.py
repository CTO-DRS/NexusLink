import json,time,sys
from llama_cpp import Llama
M=sys.argv[1]
SCHEMA={"type":"object","properties":{"action":{"type":"string","enum":["send_files","set_dnd","start_mirror","search","send_clipboard","none"]},
 "kind":{"type":"string","enum":["photo","video","file"]},"count":{"type":"integer"},"on":{"type":"boolean"},"minutes":{"type":"integer"},
 "query":{"type":"string"},"to":{"type":"string","enum":["phone","desktop"]}},"required":["action"]}
SYS=("You map a user request (Arabic or English) to ONE NexusLink action as JSON. Actions: send_files(kind,count) send photos/videos/files to the computer; "
"set_dnd(on,minutes); start_mirror(); search(query) keep the query in the user's language; send_clipboard(to=phone|desktop). "
"Use action none for anything else, including destructive or unsupported requests (deleting files, weather, chat). Output only JSON.")
llm=Llama(model_path=M,n_ctx=1024,n_threads=1,verbose=False)
cmds=json.load(open('commands.json'));ok=0;lat=[]
for c in cmds:
    t=time.time()
    r=llm.create_chat_completion(messages=[{"role":"system","content":SYS},{"role":"user","content":c["t"]}],response_format={"type":"json_object","schema":SCHEMA},temperature=0,max_tokens=60)
    dt=time.time()-t; lat.append(dt)
    out=json.loads(r["choices"][0]["message"]["content"])
    good=out.get("action")==c["a"] and all(out.get(k)==v for k,v in c["k"].items() if k!="query")
    ok+=good; print("OK " if good else "BAD",round(dt,1),c["t"],"->",json.dumps(out,ensure_ascii=False))
lat.sort(); print("accuracy",ok,"/",len(cmds),"median_s",round(lat[len(lat)//2],1),"max_s",round(lat[-1],1))

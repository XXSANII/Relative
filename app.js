const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const norm=s=>s.trim().replace(/\s+/g," ").toLowerCase();
const NEW="__new__";
let sb=null,people=[],trail=[];
const byId=id=>people.find(p=>p.id===id);
const mapRow=r=>({id:r.id,name:r.full_name,fatherId:r.father_id,motherId:r.mother_id});

/* ---- กล่องโต้ตอบในหน้า ---- */
function ask({msg,input=false,def="",choices=null,okText="ตกลง",cancel=true}){
  return new Promise(res=>{
    $("mmsg").textContent=msg;$("mok").textContent=okText;
    $("mcancel").style.display=cancel?"block":"none";
    const body=$("mbody");body.innerHTML="";let inp=null;
    if(input){inp=document.createElement("input");inp.value=def;body.appendChild(inp)}
    if(choices){body.innerHTML=choices.map((c,i)=>
      `<label class="opt"><input type="radio" name="ch" value="${esc(c.value)}" ${i===0?"checked":""}>${esc(c.label)}</label>`).join("")}
    $("modal").style.display="flex";if(inp)inp.focus();
    const done=v=>{$("modal").style.display="none";$("mok").onclick=$("mcancel").onclick=null;res(v)};
    $("mok").onclick=()=>{
      if(input)return done(inp.value);
      if(choices){const r=body.querySelector("input:checked");return done(r?r.value:null)}
      done(true)};
    $("mcancel").onclick=()=>done(null);
  });
}
const notify=msg=>ask({msg,cancel:false});
const guard=fn=>async(...a)=>{try{return await fn(...a)}catch(e){await notify("เกิดข้อผิดพลาด: "+(e.message||e))}};

/* ---- ชั้นข้อมูล (Supabase) ---- */
async function loadPeople(){
  const {data,error}=await sb.from("person").select("id,full_name,father_id,mother_id").order("full_name");
  if(error)throw error;
  people=data.map(mapRow);
}
async function addPerson(name,fatherId=null,motherId=null){
  const {data,error}=await sb.from("person")
    .insert({full_name:name.trim(),father_id:fatherId,mother_id:motherId}).select().single();
  if(error)throw error;
  const p=mapRow(data);people.push(p);return p;
}
async function updateParents(id,patch){
  const row={};
  if("fatherId"in patch)row.father_id=patch.fatherId;
  if("motherId"in patch)row.mother_id=patch.motherId;
  const {error}=await sb.from("person").update(row).eq("id",id);
  if(error)throw error;
  Object.assign(byId(id),patch);
}
async function removePerson(id){
  const {error}=await sb.from("person").delete().eq("id",id); // ลูกจะถูกตั้ง father_id/mother_id = null อัตโนมัติ
  if(error)throw error;
  people=people.filter(x=>x.id!==id);
  people.forEach(x=>{if(x.fatherId===id)x.fatherId=null;if(x.motherId===id)x.motherId=null});
}

/* ---- ตรรกะหน้าจอ ---- */
async function getOrCreate(name){
  const m=people.filter(p=>norm(p.name)===norm(name));
  if(!m.length)return addPerson(name);
  if(m.length===1)return m[0];
  const choices=m.map(p=>({value:String(p.id),
    label:`${p.name} (พ่อ: ${p.fatherId?byId(p.fatherId).name:"-"}, แม่: ${p.motherId?byId(p.motherId).name:"-"})`}));
  choices.push({value:"new",label:"สร้างเป็นคนใหม่"});
  const v=await ask({msg:`มีชื่อ "${name}" หลายคน เลือกคนที่ต้องการ`,choices});
  if(v===null)return null;
  return v==="new"?addPerson(name):byId(Number(v));
}
// ช่องพ่อ/แม่เป็นช่องพิมพ์ชื่อ: ว่าง -> ไม่ระบุ, ชื่อตรงคนเดิม -> ลิงก์คนเดิม, ไม่มี -> สร้างใหม่
async function resolveName(inputId){
  const n=$(inputId).value.trim();
  if(!n)return{id:null};
  const p=await getOrCreate(n);
  return p?{id:p.id}:{cancel:true};
}
function refreshForm(){
  // รายชื่อที่มีอยู่ ใช้เป็นคำแนะนำตอนพิมพ์ (datalist)
  $("people-list").innerHTML=people.map(p=>`<option value="${esc(p.name)}"></option>`).join("");
}

$("save").onclick=guard(async()=>{
  const name=$("name").value.trim();
  if(!name)return notify("กรุณาใส่ชื่อ");
  const fName=$("father").value.trim(),mName=$("mother").value.trim();
  // ตรวจก่อนสร้างข้อมูลใดๆ
  if(fName&&norm(fName)===norm(name)||mName&&norm(mName)===norm(name))
    return notify("พ่อ/แม่ต้องไม่ใช่คนเดียวกับตัวเอง");
  if(fName&&mName&&norm(fName)===norm(mName))
    return notify("พ่อและแม่ต้องเป็นคนละคน");
  $("save").disabled=true;
  try{
    const rf=await resolveName("father");if(rf.cancel)return;
    const rm=await resolveName("mother");if(rm.cancel)return;
    const f=rf.id,m=rm.id;
    let p=people.find(x=>norm(x.name)===norm(name));
    if(p){
      if(p.id===f||p.id===m)return notify("พ่อ/แม่ต้องไม่ใช่คนเดียวกับตัวเอง");
      const ok=await ask({msg:`มี "${p.name}" อยู่ในระบบแล้ว ต้องการเติมข้อมูลให้คนเดิมใช่ไหม?\n(เติมเฉพาะช่องพ่อ/แม่ที่ยังว่าง)`,okText:"เติมข้อมูล"});
      if(!ok)return;
      const patch={};
      if(f&&!p.fatherId)patch.fatherId=f;
      if(m&&!p.motherId)patch.motherId=m;
      if(Object.keys(patch).length)await updateParents(p.id,patch);
    }else{
      if(f&&f===m)return notify("พ่อและแม่ต้องเป็นคนละคน");
      p=await addPerson(name,f,m);
    }
    $("name").value=$("father").value=$("mother").value="";
    refreshForm();renderList();show(p.id,true);
  }finally{$("save").disabled=false}
});

function parentCell(p,key,label){
  const par=p[key]?byId(p[key]):null;
  if(par)return `<button class="link" onclick="show(${par.id})">${esc(par.name)}</button>`;
  return `<span class="muted">ไม่มีข้อมูล</span> <button class="link" onclick="addParent(${p.id},'${key}','${label}')">+ เพิ่ม</button>`;
}
const addParent=guard(async(id,key,label)=>{
  const n=await ask({msg:"ชื่อ"+label,input:true});
  if(!n||!n.trim())return;
  const par=await getOrCreate(n);if(!par)return;
  if(par.id===id)return notify("พ่อ/แม่ต้องไม่ใช่คนเดียวกับตัวเอง");
  await updateParents(id,{[key]:par.id});
  refreshForm();renderList();show(id,false,true);
});
function show(id,reset=false,keep=false){
  if(reset)trail=[];
  if(!keep&&trail[trail.length-1]!==id)trail.push(id);
  const p=byId(id);if(!p)return;
  $("profile").style.display="block";
  $("pname").textContent=p.name;
  $("pf").innerHTML=parentCell(p,"fatherId","พ่อ");
  $("pm").innerHTML=parentCell(p,"motherId","แม่");
  $("crumbs").innerHTML=trail.map(t=>byId(t)?esc(byId(t).name):"").join(" › ");
  $("back").style.display=trail.length>1?"block":"none";
}
const deletePerson=guard(async id=>{
  const p=byId(id);if(!p)return;
  const kids=people.filter(x=>x.fatherId===id||x.motherId===id);
  const ok=await ask({msg:`ลบ "${p.name}" ใช่ไหม? (ลบจริงในฐานข้อมูล)`+(kids.length?`\nลูก ${kids.length} คน (${kids.map(k=>k.name).join(", ")}) จะยังอยู่ แต่ช่องพ่อ/แม่จะว่าง`:""),okText:"ลบเลย"});
  if(!ok)return;
  await removePerson(id);
  trail=trail.filter(t=>t!==id);
  refreshForm();renderList();
  if(trail.length){const last=trail.pop();show(last)}else $("profile").style.display="none";
});
$("delCur").onclick=()=>deletePerson(trail[trail.length-1]);
$("back").onclick=()=>{trail.pop();const id=trail.pop();show(id)};

function renderList(){
  $("count").textContent=`(${people.length} คน)`;
  $("list").innerHTML=people.length?people.map(p=>
    `<div class="row"><button class="link" onclick="show(${p.id},true)">${esc(p.name)}</button><button class="del" onclick="deletePerson(${p.id})">ลบ</button></div>`).join("")
    :'<span class="muted">ยังไม่มีข้อมูล เริ่มลงทะเบียนคนแรกได้เลย</span>';
}

/* ---- เริ่มแอป (เวอร์ชัน demo: ไม่ต้อง login) ---- */
(async function init(){
  if(SUPABASE_URL.includes("YOUR-PROJECT")){$("setup").style.display="block";return}
  sb=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  $("app").style.display="block";
  await guard(async()=>{await loadPeople();refreshForm();renderList();
    const first=people.find(p=>p.fatherId||p.motherId);if(first)show(first.id,true)})();
})();
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const norm=s=>s.trim().replace(/\s+/g," ").toLowerCase();
const GENDER={male:"ชาย",female:"หญิง",other:"อื่น ๆ"};
// ชื่อฟิลด์ในหน้าเว็บ -> ชื่อคอลัมน์ในฐานข้อมูล
const COL={fatherId:"father_id",motherId:"mother_id",gender:"gender",phone:"phone",address:"address",spouseId:"spouse_id"};
let sb=null,people=[],trail=[];
const byId=id=>people.find(p=>p.id===id);
const mapRow=r=>({id:r.id,name:r.full_name,fatherId:r.father_id,motherId:r.mother_id,
  gender:r.gender,phone:r.phone,address:r.address,spouseId:r.spouse_id});

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
  const {data,error}=await sb.from("person")
    .select("id,full_name,father_id,mother_id,gender,phone,address,spouse_id").order("full_name");
  if(error)throw error;
  people=data.map(mapRow);
}
async function addPerson(name,fatherId=null,motherId=null,extra={}){
  const row={full_name:name.trim(),father_id:fatherId,mother_id:motherId};
  for(const k in extra)if(extra[k]!=null)row[COL[k]]=extra[k];
  const {data,error}=await sb.from("person").insert(row).select().single();
  if(error)throw error;
  const p=mapRow(data);people.push(p);return p;
}
async function updatePerson(id,patch){
  const row={};
  for(const k in patch)row[COL[k]]=patch[k];
  const {error}=await sb.from("person").update(row).eq("id",id);
  if(error)throw error;
  Object.assign(byId(id),patch);
}
async function removePerson(id){
  // ลูก/คู่สมรสที่ลิงก์อยู่ จะถูกตั้งค่าเป็น null อัตโนมัติ (on delete set null)
  const {error}=await sb.from("person").delete().eq("id",id);
  if(error)throw error;
  people=people.filter(x=>x.id!==id);
  people.forEach(x=>{
    if(x.fatherId===id)x.fatherId=null;
    if(x.motherId===id)x.motherId=null;
    if(x.spouseId===id)x.spouseId=null;
  });
}

/* ---- ตรรกะหน้าจอ ---- */
// ชื่อซ้ำ -> ใช้คนเดิม (หลายคนให้เลือก) ; ไม่มี -> สร้างใหม่ ; ยกเลิก -> คืน null
async function getOrCreate(name,gender=null){
  const m=people.filter(p=>norm(p.name)===norm(name));
  if(!m.length)return addPerson(name,null,null,{gender});
  if(m.length===1)return m[0];
  const choices=m.map(p=>({value:String(p.id),
    label:`${p.name} (พ่อ: ${p.fatherId?byId(p.fatherId).name:"-"}, แม่: ${p.motherId?byId(p.motherId).name:"-"})`}));
  choices.push({value:"new",label:"สร้างเป็นคนใหม่"});
  const v=await ask({msg:`มีชื่อ "${name}" หลายคน เลือกคนที่ต้องการ`,choices});
  if(v===null)return null;
  return v==="new"?addPerson(name,null,null,{gender}):byId(Number(v));
}
// ช่องพ่อ/แม่: ชื่อตรงคนเดิม -> ลิงก์คนเดิม, ไม่มี -> สร้างใหม่ (ตั้งเพศให้อัตโนมัติ)
async function resolveName(inputId,gender){
  const n=$(inputId).value.trim();
  if(!n)return{id:null};
  const p=await getOrCreate(n,gender);
  return p?{id:p.id}:{cancel:true};
}
function refreshForm(){
  // รายชื่อที่มีอยู่ ใช้เป็นคำแนะนำตอนพิมพ์ (datalist)
  $("people-list").innerHTML=people.map(p=>`<option value="${esc(p.name)}"></option>`).join("");
}
function clearForm(){
  ["name","phone","address","father","mother","spouse"].forEach(id=>$(id).value="");
  $("gender").value="";
}

$("save").onclick=guard(async()=>{
  const name=$("name").value.trim();
  if(!name)return notify("กรุณาใส่ชื่อ-นามสกุล");
  const fName=$("father").value.trim(),mName=$("mother").value.trim(),sName=$("spouse").value.trim();
  const gender=$("gender").value||null;
  const phone=$("phone").value.trim()||null;
  const address=$("address").value.trim()||null;
  const existing=people.find(x=>norm(x.name)===norm(name));

  // ---- ตรวจข้อมูลก่อนสร้างข้อมูลใดๆ ----
  if(!existing){
    // คนใหม่ ต้องกรอกชื่อพ่อและแม่ ไม่เช่นนั้นเพิ่มไม่ได้
    if(!fName){$("father").focus();return notify("ต้องกรอก \"ชื่อพ่อ\" ก่อน จึงจะเพิ่มได้")}
    if(!mName){$("mother").focus();return notify("ต้องกรอก \"ชื่อแม่\" ก่อน จึงจะเพิ่มได้")}
  }
  if(phone&&!/^[0-9+\-\s()]{8,20}$/.test(phone)){$("phone").focus();return notify("เบอร์โทรไม่ถูกต้อง (ใช้ตัวเลข เว้นวรรค - + ( ) ได้ 8-20 ตัว)")}
  if([fName,mName].some(x=>x&&norm(x)===norm(name)))return notify("พ่อ/แม่ต้องไม่ใช่คนเดียวกับตัวเอง");
  if(sName&&norm(sName)===norm(name))return notify("คู่สมรสต้องไม่ใช่คนเดียวกับตัวเอง");
  if(fName&&mName&&norm(fName)===norm(mName))return notify("พ่อและแม่ต้องเป็นคนละคน");
  if(sName&&[fName,mName].some(x=>x&&norm(x)===norm(sName)))return notify("คู่สมรสต้องไม่ใช่พ่อหรือแม่ของตัวเอง");

  $("save").disabled=true;
  try{
    // คู่สมรส (ถ้ามี)
    let s=null;
    if(sName){
      s=await getOrCreate(sName);if(!s)return;
      if(s.spouseId&&(!existing||s.spouseId!==existing.id))
        return notify(`"${s.name}" มีคู่สมรสเป็นคนอื่นอยู่แล้ว`);
    }
    const rf=await resolveName("father","male");if(rf.cancel)return;
    const rm=await resolveName("mother","female");if(rm.cancel)return;
    const f=rf.id,m=rm.id;

    let p=existing;
    if(p){
      if(p.id===f||p.id===m||(s&&s.id===p.id))return notify("ข้อมูลพ่อ/แม่/คู่สมรสซ้ำกับตัวเอง");
      const ok=await ask({msg:`มี "${p.name}" อยู่ในระบบแล้ว ต้องการเติมข้อมูลให้คนเดิมใช่ไหม?\n(เติมเฉพาะช่องที่ยังว่าง ไม่ทับข้อมูลเดิม)`,okText:"เติมข้อมูล"});
      if(!ok)return;
      const patch={};
      if(f&&!p.fatherId)patch.fatherId=f;
      if(m&&!p.motherId)patch.motherId=m;
      if(gender&&!p.gender)patch.gender=gender;
      if(phone&&!p.phone)patch.phone=phone;
      if(address&&!p.address)patch.address=address;
      if(s&&!p.spouseId)patch.spouseId=s.id;
      if(Object.keys(patch).length)await updatePerson(p.id,patch);
    }else{
      p=await addPerson(name,f,m,{gender,phone,address,spouseId:s?s.id:null});
    }
    // ผูกคู่สมรสให้ครบสองฝั่ง
    if(s&&p.spouseId===s.id&&s.spouseId!==p.id)await updatePerson(s.id,{spouseId:p.id});

    clearForm();refreshForm();renderList();show(p.id,true);
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
  const par=await getOrCreate(n,key==="fatherId"?"male":"female");if(!par)return;
  if(par.id===id)return notify("พ่อ/แม่ต้องไม่ใช่คนเดียวกับตัวเอง");
  await updatePerson(id,{[key]:par.id});
  refreshForm();renderList();show(id,false,true);
});
function show(id,reset=false,keep=false){
  if(reset)trail=[];
  if(!keep&&trail[trail.length-1]!==id)trail.push(id);
  const p=byId(id);if(!p)return;
  $("profile").style.display="block";
  $("pname").textContent=p.name;
  $("pg").textContent=p.gender?GENDER[p.gender]:"ไม่ระบุ";
  $("pph").textContent=p.phone||"-";
  $("pad").textContent=p.address||"-";
  const sp=p.spouseId?byId(p.spouseId):null;
  $("psp").innerHTML=sp?`<button class="link" onclick="show(${sp.id})">${esc(sp.name)}</button>`:'<span class="muted">ไม่มี</span>';
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
    :'<span class="muted">ยังไม่มีข้อมูล</span>';
}

/* ---- เริ่มแอป (เวอร์ชัน demo: ไม่ต้อง login) ---- */
(async function init(){
  if(SUPABASE_URL.includes("YOUR-PROJECT")){$("setup").style.display="block";return}
  sb=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  $("app").style.display="block";
  await guard(async()=>{await loadPeople();refreshForm();renderList();
    const first=people.find(p=>p.fatherId||p.motherId);if(first)show(first.id,true)})();
})();
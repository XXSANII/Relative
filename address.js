/* ตัวเลือกที่อยู่ไทย: บ้านเลขที่/ถนน → จังหวัด → อำเภอ/เขต → ตำบล/แขวง → รหัสไปรษณีย์
   ข้อมูลจาก th-address.json: [[จังหวัด,[[อำเภอ,[[ตำบล,รหัสไปรษณีย์],...]],...]],...] */
let ADDR_DATA=null;
async function loadAddressData(){
  if(!ADDR_DATA){const r=await fetch('th-address.json');if(!r.ok)throw new Error('โหลดข้อมูลที่อยู่ไม่สำเร็จ');ADDR_DATA=await r.json();}
  return ADDR_DATA;
}
const BKK='กรุงเทพมหานคร';
const squash=s=>String(s||'').trim().replace(/\s+/g,' ');
const addrLabels=province=>province===BKK?{district:'เขต',subdistrict:'แขวง'}:{district:'อำเภอ',subdistrict:'ตำบล'};

// ประกอบที่อยู่เป็นข้อความเต็ม สำหรับแสดงผล
function composeAddress(a){
  if(!a)return '';
  const l=addrLabels(a.province),parts=[];
  if(a.house_no)parts.push(a.house_no);
  if(a.road)parts.push(/^(ถนน|ถ\.|ซอย|ซ\.|ตรอก)/.test(a.road)?a.road:'ถนน'+a.road);
  if(a.subdistrict)parts.push(l.subdistrict+a.subdistrict);
  if(a.district)parts.push(l.district+a.district);
  if(a.province)parts.push(a.province===BKK?a.province:'จังหวัด'+a.province);
  if(a.postal_code)parts.push(a.postal_code);
  return parts.join(' ');
}

// สร้างช่องกรอกที่อยู่ใน #boxId; id ของแต่ละช่อง = prefix + ชื่อฟิลด์ (house_no, road, province, district, subdistrict, postal_code)
// คืน {get(), set(person)}
async function initAddressPicker(prefix,boxId){
  const data=await loadAddressData(),id=k=>prefix+k,el=k=>$(id(k));
  const opts=items=>items.map(v=>`<option value="${esc(v)}"></option>`).join('');
  $(boxId).innerHTML=`
    <label for="${id('house_no')}">บ้านเลขที่ / หมู่ / ซอย</label><input id="${id('house_no')}" maxlength="100" autocomplete="off" placeholder="เช่น 99/1 หมู่ 3">
    <label for="${id('road')}">ถนน</label><input id="${id('road')}" maxlength="100" autocomplete="off" placeholder="เช่น สุขุมวิท">
    <div id="${id('geo')}" hidden>
      <label for="${id('province')}">จังหวัด *</label><input id="${id('province')}" list="${id('province_list')}" autocomplete="off" placeholder="พิมพ์เพื่อค้นหา เช่น เชียงใหม่"><datalist id="${id('province_list')}">${opts(data.map(p=>p[0]))}</datalist>
      <div id="${id('district_wrap')}" hidden><label for="${id('district')}" id="${id('district_label')}">อำเภอ *</label><input id="${id('district')}" list="${id('district_list')}" autocomplete="off"><datalist id="${id('district_list')}"></datalist></div>
      <div id="${id('subdistrict_wrap')}" hidden><label for="${id('subdistrict')}" id="${id('subdistrict_label')}">ตำบล *</label><input id="${id('subdistrict')}" list="${id('subdistrict_list')}" autocomplete="off"><datalist id="${id('subdistrict_list')}"></datalist></div>
      <div id="${id('postal_wrap')}" hidden><label for="${id('postal_code')}">รหัสไปรษณีย์ *</label><input id="${id('postal_code')}" inputmode="numeric" maxlength="5" autocomplete="off"><p class="hint">ระบบเติมให้ตามตำบลที่เลือก แก้ไขได้ถ้าไม่ตรง</p></div>
    </div>`;
  const prov=()=>data.find(p=>p[0]===squash(el('province').value))||null;
  const dist=()=>{const p=prov();return p&&p[1].find(d=>d[0]===squash(el('district').value))||null;};
  const sub=()=>{const d=dist();return d&&d[1].find(s=>s[0]===squash(el('subdistrict').value))||null;};
  const show=(k,on)=>{$(id(k+'_wrap')).hidden=!on;};

  function refresh(fromProvince,fromDistrict,fromSub){
    const p=prov();
    const l=addrLabels(p&&p[0]);
    $(id('district_label')).textContent=l.district+' *';$(id('subdistrict_label')).textContent=l.subdistrict+' *';
    // ค่าที่เลือกไว้ต้องมีอยู่จริงในจังหวัด/อำเภอนั้น ไม่เช่นนั้นล้างค่าที่ตามมา
    if(fromProvince&&el('district').value&&!dist())el('district').value='';
    if((fromProvince||fromDistrict)&&el('subdistrict').value&&!sub())el('subdistrict').value='';
    show('district',!!p);
    $(id('district_list')).innerHTML=p?opts(p[1].map(d=>d[0])):'';
    const d=dist();
    show('subdistrict',!!d);
    $(id('subdistrict_list')).innerHTML=d?opts(d[1].map(s=>s[0])):'';
    const s=sub();
    show('postal',!!s);
    if(s&&fromSub)el('postal_code').value=s[1];
    if(!s)el('postal_code').value='';
  }
  const syncGeo=()=>{$(id('geo')).hidden=!(squash(el('house_no').value)||squash(el('road').value)||el('province').value.trim());};
  el('house_no').addEventListener('input',syncGeo);el('road').addEventListener('input',syncGeo);
  el('province').addEventListener('input',()=>{syncGeo();refresh(true,false,false);});
  el('district').addEventListener('input',()=>refresh(false,true,false));
  el('subdistrict').addEventListener('input',()=>refresh(false,false,true));
  el('postal_code').addEventListener('input',()=>{el('postal_code').value=el('postal_code').value.replace(/\D/g,'').slice(0,5);});

  return {
    // ใส่ค่าจากข้อมูลบุคคล (หน้าแก้ไข)
    set(a){
      el('house_no').value=a.house_no||'';el('road').value=a.road||'';el('province').value=a.province||'';
      syncGeo();refresh(true,false,false);
      el('district').value=a.district||'';refresh(false,true,false);
      el('subdistrict').value=a.subdistrict||'';refresh(false,false,false);
      if(sub())el('postal_code').value=a.postal_code||sub()[1];
    },
    // อ่านและตรวจค่า → {values} หรือ {error,focus}
    get(){
      const v={house_no:squash(el('house_no').value)||null,road:squash(el('road').value)||null,province:null,district:null,subdistrict:null,postal_code:null,address:null};
      if(!v.house_no&&!v.road&&!squash(el('province').value))return {values:v};   // ไม่กรอกที่อยู่เลย
      if(!prov())return {error:'กรุณาเลือกจังหวัดจากรายการที่แนะนำ',focus:id('province')};
      if(!dist())return {error:`กรุณาเลือก${addrLabels(prov()[0]).district}จากรายการที่แนะนำ`,focus:id('district')};
      if(!sub())return {error:`กรุณาเลือก${addrLabels(prov()[0]).subdistrict}จากรายการที่แนะนำ`,focus:id('subdistrict')};
      const zip=el('postal_code').value.trim();
      if(!/^[0-9]{5}$/.test(zip))return {error:'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก',focus:id('postal_code')};
      v.province=prov()[0];v.district=dist()[0];v.subdistrict=sub()[0];v.postal_code=zip;v.address=composeAddress(v);
      return {values:v};
    }
  };
}

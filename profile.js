(async()=>{
 let person=null,me=null;
 const id=Number(new URLSearchParams(location.search).get('id'));
 try{me=await currentPerson();if(!me){location.href='login.html';return;}if(!id){location.replace(`profile.html?id=${me.id}`);return;}
  const {data,error}=await sb.from('person').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!data)throw new Error('ไม่พบข้อมูลบุคคล');person=data;
  const own=person.id===me.id;$('avatar').src=avatarUrl(person.avatar_path);$('name').textContent=person.full_name||'-';$('ownerLabel').textContent=own?'โปรไฟล์ของคุณ':'ข้อมูลญาติ';$('gender').textContent=GENDER[person.gender]||'ไม่ระบุ';$('phone').textContent=person.phone||'-';$('address').textContent=person.address||'-';
  // มี id = ลงทะเบียนแล้ว กดเข้าไปดูได้ / มีแต่ชื่อ = ยังไม่ได้ลงทะเบียน แสดงเป็นข้อความ
  const linkPerson=async(relId,relName,field)=>{
    if(relId){const {data,error}=await sb.from('person').select('id,full_name').eq('id',relId).maybeSingle();if(error)throw error;
      if(data){$(field).innerHTML=`<button class="relation" data-person="${data.id}">${esc(data.full_name)}</button>`;return;}}
    $(field).innerHTML=relName?`<span class="pending">${esc(relName)}<small>(ยังไม่ได้ลงทะเบียน)</small></span>`:'-';
  };
  await linkPerson(person.father_id,person.father_name,'father');await linkPerson(person.mother_id,person.mother_name,'mother');await linkPerson(person.spouse_id,person.spouse_name,'spouse');
  document.querySelectorAll('[data-person]').forEach(b=>b.addEventListener('click',()=>location.href=`profile.html?id=${b.dataset.person}`));
  $('ownerActions').hidden=!own;
  const [firstName,...rest]=String(person.full_name||'').trim().split(/\s+/);
  $('editBtn').onclick=async()=>{ $('view').hidden=true;$('editForm').hidden=false;
    $('e_first').value=firstName||'';$('e_last').value=rest.join(' ');$('e_phone').value=person.phone||'';$('e_gender').value=person.gender||'';$('e_address').value=person.address||'';
    $('e_father').value=person.father_name||'';$('e_mother').value=person.mother_name||'';$('e_spouse').value=person.spouse_name||'';
    $('e_avatar').value='';$('e_preview').hidden=true;
    const {data}=await sb.from('person').select('full_name').neq('id',person.id).order('full_name');
    $('peopleList').innerHTML=(data||[]).map(p=>`<option value="${esc(p.full_name)}"></option>`).join('');
  };
  $('cancelBtn').onclick=()=>{$('editForm').hidden=true;$('view').hidden=false;showMessage('message','');};
  $('e_avatar').onchange=()=>{const f=$('e_avatar').files[0];if(!f){$('e_preview').hidden=true;return;}if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>5*1024*1024){$('e_avatar').value='';showMessage('message','รูปต้องเป็น JPG, PNG หรือ WebP และไม่เกิน 5 MB');return;}const r=new FileReader();r.onload=()=>{$('e_preview').src=r.result;$('e_preview').hidden=false};r.readAsDataURL(f);};
  $('editForm').onsubmit=async e=>{e.preventDefault();showMessage('message','');const btn=$('saveBtn');btn.disabled=true;
    try{
      const first=$('e_first').value.trim().replace(/\s+/g,' '),last=$('e_last').value.trim().replace(/\s+/g,' '),phone=normalizePhone($('e_phone').value);
      if(first.length<2||/\s/.test(first))throw new Error('กรุณากรอกชื่อจริงเป็นคำเดียว (ไม่ต้องใส่นามสกุล)');
      if(last.length<2)throw new Error('กรุณากรอกนามสกุลให้ถูกต้อง');
      if(!validPhone(phone))throw new Error('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง เช่น 0812345678');
      const name=`${first} ${last}`;
      const rel=k=>$(k).value.trim().replace(/\s+/g,' ')||null;
      const patch={full_name:name,phone,gender:$('e_gender').value||null,address:$('e_address').value.trim()||null,father_name:rel('e_father'),mother_name:rel('e_mother'),spouse_name:rel('e_spouse')};
      if([patch.father_name,patch.mother_name,patch.spouse_name].some(n=>n&&normalize(n)===normalize(name)))throw new Error('ชื่อพ่อ แม่ หรือคู่สมรส ต้องไม่ใช่ชื่อของตัวเอง');
      // ชื่อจริงหรือเบอร์เปลี่ยน → อัปเดตบัญชี Supabase Auth ให้ล็อกอินด้วยค่าใหม่
      if(own){
        const {data:{user}}=await sb.auth.getUser();
        const email=await accountEmail(first,phone),auth={};
        if(user.email!==email){auth.email=email;auth.data={username:first,first_name:first,last_name:last};}
        // บัญชีระบบเดิม (u-...) อาจตั้งรหัสเป็นเบอร์แบบมีขีด จึงตั้งรหัสใหม่ด้วย
        if(normalizePhone(person.phone)!==phone||user.email.startsWith('u-'))auth.password=phone;
        if(Object.keys(auth).length){let {error:authError}=await sb.auth.updateUser(auth);
          if(authError?.code==='same_password'){delete auth.password;({error:authError}=Object.keys(auth).length?await sb.auth.updateUser(auth):{error:null});}
          if(authError)throw new Error(/already|registered|exists/i.test(authError.message)?'มีบัญชีที่ใช้ชื่อจริงและเบอร์โทรนี้อยู่แล้ว':'อัปเดตข้อมูลเข้าสู่ระบบไม่สำเร็จ: '+authError.message);}
      }
      const file=$('e_avatar').files[0];if(file){const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type],path=`${person.id}/avatar-${Date.now()}.${ext}`;const {error:uploadError}=await sb.storage.from(AVATAR_BUCKET).upload(path,file,{contentType:file.type});if(uploadError)throw uploadError;patch.avatar_path=path;}
      const {error}=await sb.from('person').update(patch).eq('id',person.id);if(error)throw error;if(patch.avatar_path&&person.avatar_path)await sb.storage.from(AVATAR_BUCKET).remove([person.avatar_path]);location.reload();
    }catch(err){showMessage('message',err.message||'บันทึกไม่สำเร็จ');}finally{btn.disabled=false;}};
  $('deleteBtn').onclick=async()=>{if(!confirm('ยืนยันลบข้อมูลของคุณหรือไม่? การลบข้อมูลบุคคลไม่สามารถย้อนกลับได้'))return;const btn=$('deleteBtn');btn.disabled=true;try{if(person.avatar_path)await sb.storage.from(AVATAR_BUCKET).remove([person.avatar_path]);const {error}=await sb.from('person').delete().eq('id',person.id);if(error)throw error;await sb.auth.signOut();location.href='register.html';}catch(err){showMessage('message',err.message||'ลบข้อมูลไม่สำเร็จ');btn.disabled=false;}};
 }catch(e){showMessage('message',e.message||'โหลดโปรไฟล์ไม่สำเร็จ');}
})();

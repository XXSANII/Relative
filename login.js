(async()=>{
  const {data:{session}}=await sb.auth.getSession();if(session){location.href='main.html';return;}
  $('loginForm').addEventListener('submit',async e=>{e.preventDefault();showMessage('message','');const btn=$('submitBtn');btn.disabled=true;
    try{const username=$('username').value.trim().replace(/\s+/g,' '),rawPhone=$('password').value.trim();if(!username||!rawPhone)throw new Error('กรุณากรอก Username และ Password');
      const phone=normalizePhone(rawPhone);
      let {error}=await sb.auth.signInWithPassword({email:await accountEmail(username,phone),password:phone});
      // บัญชีที่สมัครด้วยระบบเดิม (Username = ชื่อ-นามสกุล)
      if(error) ({error}=await sb.auth.signInWithPassword({email:await usernameEmail(username),password:rawPhone}));
      if(error)throw new Error('ชื่อจริงหรือเบอร์โทรศัพท์ไม่ถูกต้อง');
      const p=await currentPerson();if(!p){await sb.auth.signOut();throw new Error('บัญชีนี้ยังไม่มีข้อมูลบุคคลที่เชื่อมโยง กรุณาติดต่อผู้ดูแลระบบ');}location.href='main.html';
    }catch(err){showMessage('message',err.message||'เข้าสู่ระบบไม่สำเร็จ');}finally{btn.disabled=false;}
  });
})();

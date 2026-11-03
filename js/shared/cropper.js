/* ครอปรูปโปรไฟล์: ลากเพื่อเลื่อน เลื่อนแถบ/ล้อเมาส์/บีบนิ้วเพื่อซูม แล้วตัดเป็นสี่เหลี่ยมจัตุรัส 512x512 (JPEG)
   cropAvatar(file) → Promise<File | null>  (null = ยกเลิก หรือเปิดรูปไม่ได้) */
const CROP_VIEW = 300,
  CROP_OUT = 512;

function cropAvatar(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.onload = () => {
      const dlg = document.createElement("dialog");
      dlg.className = "crop-dialog";
      dlg.innerHTML = `<form method="dialog">
        <h2>เลือกส่วนของรูปที่ต้องการ</h2>
        <p class="hint">ลากรูปเพื่อเลื่อน ใช้แถบด้านล่างหรือล้อเมาส์ (บีบนิ้วบนมือถือ) เพื่อซูม</p>
        <canvas class="crop-canvas" width="${CROP_VIEW}" height="${CROP_VIEW}"></canvas>
        <input class="crop-zoom" type="range" min="1" max="4" step="0.01" value="1" aria-label="ซูม">
        <div class="actions"><button type="submit" class="crop-ok">ใช้รูปนี้</button><button type="button" class="ghost crop-cancel">ยกเลิก</button></div>
      </form>`;
      document.body.appendChild(dlg);
      const cv = dlg.querySelector(".crop-canvas"),
        ctx = cv.getContext("2d"),
        zoomEl = dlg.querySelector(".crop-zoom");
      const base = Math.max(CROP_VIEW / img.width, CROP_VIEW / img.height); // พอดีกรอบ (ไม่มีขอบว่าง)
      let zoom = 1,
        ox = 0,
        oy = 0; // ตำแหน่งกึ่งกลางรูปเทียบกึ่งกลางกรอบ
      const clamp = () => {
        const w = img.width * base * zoom,
          h = img.height * base * zoom;
        ox = Math.min((w - CROP_VIEW) / 2, Math.max((CROP_VIEW - w) / 2, ox));
        oy = Math.min((h - CROP_VIEW) / 2, Math.max((CROP_VIEW - h) / 2, oy));
      };
      const paint = (c, size) => {
        const k = size / CROP_VIEW,
          w = img.width * base * zoom * k,
          h = img.height * base * zoom * k;
        c.fillStyle = "#fff";
        c.fillRect(0, 0, size, size);
        c.drawImage(img, size / 2 + ox * k - w / 2, size / 2 + oy * k - h / 2, w, h);
      };
      const draw = () => {
        clamp();
        paint(ctx, CROP_VIEW);
        // วงกลมบอกส่วนที่จะเห็นเป็นรูปโปรไฟล์ (พื้นที่นอกวงมืดลง)
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.beginPath();
        ctx.rect(0, 0, CROP_VIEW, CROP_VIEW);
        ctx.arc(CROP_VIEW / 2, CROP_VIEW / 2, CROP_VIEW / 2 - 2, 0, Math.PI * 2, true);
        ctx.fill("evenodd");
        ctx.restore();
      };
      const setZoom = (z) => {
        zoom = Math.min(4, Math.max(1, z));
        zoomEl.value = zoom;
        draw();
      };
      zoomEl.addEventListener("input", () => setZoom(Number(zoomEl.value)));
      cv.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
        },
        { passive: false },
      );
      // ลาก 1 นิ้ว = เลื่อน, 2 นิ้ว = ซูม
      const pts = new Map();
      let pinch = 0;
      cv.addEventListener("pointerdown", (e) => {
        cv.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        pinch = 0;
      });
      cv.addEventListener("pointermove", (e) => {
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId);
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        const rect = cv.getBoundingClientRect(),
          s = CROP_VIEW / rect.width;
        if (pts.size === 1) {
          ox += (e.clientX - prev[0]) * s;
          oy += (e.clientY - prev[1]) * s;
          draw();
        } else if (pts.size === 2) {
          const [a, b] = [...pts.values()],
            d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (pinch) setZoom(zoom * (d / pinch));
          pinch = d;
        }
      });
      const up = (e) => {
        pts.delete(e.pointerId);
        pinch = 0;
      };
      cv.addEventListener("pointerup", up);
      cv.addEventListener("pointercancel", up);

      let result = null;
      const finish = () => {
        URL.revokeObjectURL(url);
        dlg.remove();
        resolve(result);
      };
      dlg.querySelector("form").addEventListener("submit", (e) => {
        e.preventDefault();
        const out = document.createElement("canvas");
        out.width = out.height = CROP_OUT;
        paint(out.getContext("2d"), CROP_OUT);
        out.toBlob(
          (blob) => {
            result = blob
              ? new File([blob], "avatar.jpg", { type: "image/jpeg" })
              : null;
            dlg.close();
          },
          "image/jpeg",
          0.9,
        );
      });
      dlg.querySelector(".crop-cancel").addEventListener("click", () => dlg.close());
      dlg.addEventListener("close", finish, { once: true });
      draw();
      dlg.showModal();
    };
    img.src = url;
  });
}

// ผูกกับ <input type="file">: หลังตรวจชนิด/ขนาดแล้วเปิดหน้าครอป แล้วแทนที่ไฟล์ในช่องด้วยรูปที่ครอป
// คืน File ที่ครอปแล้ว หรือ null ถ้ายกเลิก (ช่องจะถูกล้าง)
async function cropIntoInput(input, file) {
  const cropped = await cropAvatar(file);
  if (!cropped) {
    input.value = "";
    return null;
  }
  const dt = new DataTransfer();
  dt.items.add(cropped);
  input.files = dt.files;
  return cropped;
}

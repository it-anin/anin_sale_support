# 💎 SIGYA Premium Card Carousel - ระบบพิมพ์ป้ายราคาแบบพรีเมียม

ระบบพิมพ์ป้ายราคาและบาร์โค้ดสำหรับร้านยา ด้วย **Design 7: Card Carousel Premium** 
สไตล์หรูหรา สีทอง-ครีม เหมาะกับร้านยาระดับพรีเมียม

---

## ✨ คุณสมบัติเด่น

### 🎨 ดีไซน์พรีเมียม
- **สีสัน**: ทอง (#d4af37) + ครีม (#faf8f5) + น้ำตาล (#2d2a26)
- **Typography**: Playfair Display (หัวข้อ) + Inter (เนื้อหา)
- **สไตล์**: Luxury E-commerce Card Design
- **Responsive**: รองรับทุกขนาดหน้าจอ

### 🚀 ฟังก์ชันครบครัน
- ✅ อัพโหลด CSV จาก POS
- ✅ ค้นหาสินค้า (SKU, บาร์โค้ด, ชื่อ)
- ✅ กรองตามหมวดหมู่
- ✅ เลือกสินค้าแบบการ์ด
- ✅ จัดการจำนวนป้าย
- ✅ แสดงตัวอย่างก่อนพิมพ์
- ✅ พิมพ์ป้ายขนาด 4.5×4 cm
- ✅ สร้างบาร์โค้ด CODE128 อัตโนมัติ

### 📊 สถิติแบบเรียลไทม์
- จำนวนสินค้าทั้งหมด
- รายการที่เลือก
- ป้ายที่จะพิมพ์
- ผลการค้นหา

---

## 🚀 วิธีติดตั้งและใช้งาน

### 1. ติดตั้ง Dependencies

```bash
npm install
```

หรือใช้ yarn:

```bash
yarn install
```

### 2. เริ่มต้นใช้งาน

```bash
npm run dev
```

โปรแกรมจะเปิดที่: `http://localhost:3000`

### 3. Build สำหรับ Production

```bash
npm run build
```

ไฟล์ที่ build แล้วจะอยู่ในโฟลเดอร์ `dist/`

---

## 📁 โครงสร้างโปรเจค

```
pharmacy-premium/
├── src/
│   ├── App.tsx          # Component หลัก
│   ├── App.css          # Premium Card Carousel Styles
│   ├── main.tsx         # Entry point
│   └── index.css        # Global styles + Fonts
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
├── vite.config.ts       # Vite config
└── index.html           # HTML template
```

---

## 📋 รูปแบบไฟล์ CSV

ไฟล์ CSV จาก POS ต้องมีคอลัมน์ดังนี้:

| คอลัมน์ | ข้อมูล | ตัวอย่าง |
|---------|--------|----------|
| A | Barcode | 8850987000010 |
| E | SKU | 200009 |
| F | ชื่อสินค้า | Alcon Tears Naturale |
| G | หน่วย | Box |
| I | ราคา | 353.00 |

### ตัวอย่างไฟล์ CSV:

```csv
Barcode,Brand,Category,SubCategory,SKU,Name,Unit,Cost,Price,Stock
8850987000010,Alcon,Medicines,Eye Care,200009,Alcon Tears Naturale Free 0.8 ml x 32 pcs,Box,300.00,353.00,50
8877003720,Tillots,Medicines,Digestive,100314,Colpermin 10×10's,Box,100.00,122.00,100
```

---

## 💡 วิธีใช้งาน

### ขั้นตอนที่ 1: อัพโหลด CSV
1. คลิกปุ่ม **"📂 อัพโหลด CSV"**
2. เลือกไฟล์ CSV จาก POS
3. รอระบบโหลดข้อมูล

### ขั้นตอนที่ 2: ค้นหาและเลือกสินค้า
1. ใช้แถบค้นหา หรือกรองตามหมวดหมู่
2. คลิกที่การ์ดสินค้าเพื่อเลือก
3. หรือคลิก **"+ เพิ่มลงรายการ"** เพื่อเพิ่มทีละชิ้น

### ขั้นตอนที่ 3: กำหนดจำนวนป้าย
1. ดูรายการที่เลือกด้านล่าง
2. ใช้ปุ่ม **+/−** เพื่อเพิ่ม/ลดจำนวนป้าย
3. คลิก **🗑️** เพื่อลบรายการ

### ขั้นตอนที่ 4: แสดงตัวอย่าง
1. คลิก **"👁️ แสดงตัวอย่าง"**
2. ตรวจสอบป้ายทั้งหมด
3. ปิด Modal ถ้าต้องการแก้ไข

### ขั้นตอนที่ 5: พิมพ์
1. คลิก **"🖨️ พิมพ์ป้ายราคา"**
2. ตั้งค่าเครื่องพิมพ์:
   - กระดาษ: A4
   - Margins: ปกติ
   - Scale: 100%
3. คลิกพิมพ์

---

## 🎨 การปรับแต่งสี

หากต้องการเปลี่ยนสีประจำร้าน แก้ไขไฟล์ `src/App.css`:

### สีทอง (Gold):
```css
/* เปลี่ยนจาก #d4af37 เป็นสีที่ต้องการ */
background: linear-gradient(135deg, #d4af37, #f2d98d);
```

### สีพื้นหลัง (Background):
```css
/* เปลี่ยนจาก #faf8f5 เป็นสีที่ต้องการ */
background: #faf8f5;
```

### สีเข้ม (Dark):
```css
/* เปลี่ยนจาก #2d2a26 เป็นสีที่ต้องการ */
background: linear-gradient(135deg, #2d2a26, #4a443d);
```

---

## 🖨️ การตั้งค่าเครื่องพิมพ์

### ขนาดป้าย
- **กว้าง**: 4.5 cm
- **สูง**: 4.0 cm
- **กรอบ**: สีทอง 2px

### เนื้อหาในป้าย
1. **ชื่อสินค้า** (บรรทัดบน) - 9pt, ตัดไม่เกิน 2 บรรทัด
2. **ราคา** (ตรงกลาง) - 24pt, ตัวหนา, สีทอง
3. **บาร์โค้ด** (ล่าง) - CODE128, สูง 1cm

### การจัดเรียงบนกระดาษ A4
- แนวนอน: 4 ป้าย
- แนวตั้ง: 7 แถว
- รวม: **28 ป้าย/หน้า**

---

## 🔧 แก้ปัญหาที่พบบ่อย

### ❓ ไฟล์ CSV ไม่ขึ้น
- ✅ ตรวจสอบว่าไฟล์เป็น `.csv` จริง
- ✅ เปิดด้วย Excel/Notepad ตรวจสอบคอลัมน์
- ✅ ตรวจสอบว่ามี Header row (บรรทัดแรก)

### ❓ บาร์โค้ดไม่แสดง
- ✅ ตรวจสอบว่า Barcode ในไฟล์ CSV ถูกต้อง
- ✅ บาร์โค้ดต้องเป็นตัวเลข 8-13 หลัก
- ✅ ลอง Refresh หน้าเพจ

### ❓ พิมพ์ออกมาขนาดไม่ถูก
- ✅ ตั้งค่า Scale ที่ 100%
- ✅ ตั้งค่า Margins เป็น Default
- ✅ เลือก Paper size เป็น A4

### ❓ ค้นหาไม่เจอ
- ✅ ตรวจสอบการสะกดคำ
- ✅ ลองค้นหาด้วย SKU หรือ Barcode
- ✅ ลบ Filter หมวดหมู่ (กลับไปที่ "ทั้งหมด")

---

## 🎯 เคล็ดลับการใช้งาน

### เพิ่มความเร็ว
1. ใช้ **Filter หมวดหมู่** แทนการค้นหา
2. เลือกหลายรายการพร้อมกัน
3. ใช้ปุ่ม **"+ เพิ่มลงรายการ"** แทนการ toggle

### ทำงานได้เร็วขึ้น
1. เตรียมไฟล์ CSV ไว้ก่อน
2. จำ SKU สินค้าขายดี
3. ใช้ Search แทนการเลื่อนหา

### ลดข้อผิดพลาด
1. ใช้ **"👁️ แสดงตัวอย่าง"** ก่อนพิมพ์ทุกครั้ง
2. ตรวจสอบราคาและบาร์โค้ด
3. Print ทดสอบ 1 หน้าก่อน

---

## 📊 ข้อมูลทางเทคนิค

### เทคโนโลยีที่ใช้
- **React 18** - UI Framework
- **TypeScript** - Type Safety
- **Vite** - Build Tool (เร็วมาก!)
- **PapaParse** - CSV Parser
- **JsBarcode** - Barcode Generator

### Browser Support
- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+

### ข้อกำหนดระบบ
- **Node.js**: 16.0 ขึ้นไป
- **RAM**: 2GB ขึ้นไป
- **Disk**: 500MB ว่าง

---

## 🎨 คุณสมบัติพิเศษของ Design 7

### 1. Premium Card Design
- การ์ดขนาดใหญ่ 380px
- รูปภาพสินค้าด้านบน 200px
- Badge แสดงหมวดหมู่
- Hover effect แบบ smooth

### 2. Luxury Color Scheme
- สีทอง (#d4af37) สื่อถึงความหรูหรา
- สีครีม (#faf8f5) นุ่มนวล
- สีน้ำตาล (#2d2a26) มีระดับ

### 3. Typography Excellence
- **Playfair Display** - Serif สำหรับหัวข้อ
- **Inter** - Sans-serif สำหรับเนื้อหา
- ผสมผสานได้ลงตัว

### 4. Responsive Design
- จอใหญ่: 3 การ์ด/แถว
- Tablet: 2 การ์ด/แถว
- Mobile: 1 การ์ด/แถว

### 5. Interactive Elements
- Gradient buttons
- Smooth animations
- Hover effects
- Loading states

---

## 📱 การใช้งานบนมือถือ

### iOS Safari
1. เปิดเว็บบน Safari
2. แตะ Share icon
3. เลือก "Add to Home Screen"
4. ใช้งานแบบ App

### Android Chrome
1. เปิดเว็บบน Chrome
2. แตะ Menu (⋮)
3. เลือก "Add to Home screen"
4. ใช้งานแบบ App

---

## 🔒 ความปลอดภัย

### ข้อมูล
- ❌ ไม่มีการส่งข้อมูลไปเซิร์ฟเวอร์
- ✅ ทุกอย่างทำงานใน Browser
- ✅ ข้อมูลหายเมื่อ Refresh

### Privacy
- ไม่มีการเก็บ Log
- ไม่มีการติดตาม
- ไม่มี Analytics

---

## 🎓 สำหรับนักพัฒนา

### การแก้ไข Component

```typescript
// src/App.tsx
interface Product {
  barcode: string;
  sku: string;
  name: string;
  unit: string;
  price: number;
  category?: string;
  rowIndex: number;
}
```

### การเพิ่ม Feature

1. แก้ไข `App.tsx` เพิ่ม State/Function
2. แก้ไข `App.css` เพิ่ม Styles
3. Test ด้วย `npm run dev`
4. Build ด้วย `npm run build`

### Custom Barcode Format

```typescript
// แก้ไขใน generateBarcode function
JsBarcode(canvas, barcode, {
  format: 'EAN13',  // เปลี่ยนจาก CODE128
  width: 2,
  height: 60,
  displayValue: false
});
```

---

## 📞 ติดต่อและสนับสนุน

### ต้องการความช่วยเหลือ?
- 📧 อ่าน README นี้อีกครั้ง
- 🔍 ดูที่ "แก้ปัญหาที่พบบ่อย"
- 💡 ลองค้นหาใน Issues (GitHub)

### ต้องการฟีเจอร์เพิ่ม?
- เขียน Feature Request
- แนบ Mock-up/ภาพตัวอย่าง
- อธิบายว่าต้องการอะไร

---

## 🎉 สิ่งที่จะมาในอนาคต

- [ ] Export เป็น PDF
- [ ] บันทึกเทมเพลต
- [ ] Multi-language support
- [ ] Dark mode
- [ ] QR Code support
- [ ] ราคาหลายสกุลเงิน

---

## 📄 License

โปรเจคนี้สร้างขึ้นสำหรับ BIGYA Pharmacy  
สามารถใช้งานและแก้ไขได้อย่างอิสระ

---

## 🙏 ขอบคุณ

ขอบคุณที่เลือกใช้ **BIGYA Premium Card Carousel System**  
หวังว่าจะช่วยให้การทำงานของคุณง่ายและรวดเร็วขึ้น

**Happy Printing! 🖨️✨**

---

สร้างด้วย ❤️ โดย SIGYA Development Team  
Version 1.0.0 | Design 7: Card Carousel Premium

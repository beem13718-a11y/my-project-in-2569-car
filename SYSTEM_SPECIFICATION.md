# 📑 เอกสารข้อมูลเชิงเทคนิคและสถาปัตยกรรมระบบ GarageFlow
**โครงการ:** ระบบสารสนเทศเพื่อการบริหารจัดการอู่ซ่อมบำรุงยานยนต์อัจฉริยะ (GarageFlow)  
**สำหรับ:** เล่มปริญญานิพนธ์ (บทที่ 3 และบทที่ 4)  
**วันที่จัดทำ:** 12 กันยายน 2569  

---

## 1. ภาพรวมและสถาปัตยกรรมการทำงานของระบบ (System Overview & Architecture)

ระบบ GarageFlow พัฒนาขึ้นภายใต้สถาปัตยกรรม **MVC (Model-View-Controller)** บนรูปแบบ **Client-Server Architecture** โดยมุ่งเน้นประสิทธิภาพ ความเร็ว และความปลอดภัย:

- **Client (Frontend)**: พัฒนาด้วย **EJS Template Engine** ร่วมกับ **Bootstrap 5** แบบ Responsive Web Design รองรับการแสดงผลทุกขนาดหน้าจอ (Desktop, Tablet, Mobile)
- **Server (Backend)**: ขับเคลื่อนด้วย **Node.js** และ **Express.js Framework** จัดการเส้นทาง Routing, การประมวลผล Business Logic, ระบบ Authentication และการเชื่อมต่อ Webhook
- **Database (Data Storage)**: จัดเก็บข้อมูลในระบบฐานข้อมูลเชิงสัมพันธ์ **MariaDB / MySQL** ผ่าน Connection Pool ของไลบรารี `mysql2/promise`
- **External Integration**: เชื่อมโยงกับ **LINE Messaging Platform API** ผ่านระบบ Webhook และ Push Notification Service สำหรับการตอบกลับอัตโนมัติ 24 ชม.

```mermaid
flowchart TD
    subgraph Clients ["ฝั่งผู้ใช้งาน (Clients)"]
        Browser["🖥️ เว็บเบราว์เซอร์ (เจ้าของอู่ / ช่าง / ลูกค้า)"]
        MobileLine["📱 แอปพลิเคชัน LINE (ลูกค้า / แอดมิน)"]
    end

    subgraph Backend ["ฝั่งเซิร์ฟเวอร์ (Node.js + Express)"]
        Router["Router / Controller (MVC Pattern)"]
        AuthSec["Security & Session Layer (Bcrypt, Helmet)"]
        BillingEngine["Billing & Dynamic PromptPay QR Engine"]
        LineEngine["LINE Webhook & Notification Engine"]
    end

    subgraph Storage ["ฐานข้อมูล & สื่อจัดเก็บ"]
        DB[(MariaDB / MySQL Database)]
        Uploads["📁 ที่จัดเก็บรูปภาพ (public/uploads)"]
    end

    subgraph External ["บริการภายนอก"]
        LineServer["☁️ LINE Messaging Platform API"]
    end

    Browser <-->|HTTP / HTTPS| Router
    MobileLine <-->|LINE Chat| LineServer
    LineServer <-->|Webhook / REST API| LineEngine

    Router <--> AuthSec
    Router <--> BillingEngine
    Router <--> LineEngine

    Router <-->|SQL Queries (Connection Pool)| DB
    Router <-->|จัดเก็บรูปภาพ (Multer)| Uploads
```

---

## 2. ขอบเขตความสามารถและหน้าที่การทำงาน (Functional Breakdown)

ระบบประกอบด้วย 7 โมดูลหลัก ดังนี้:

### 1) 🚗 ระบบบริหารงานซ่อมบำรุง (Repair Management)
- **รับรถเข้าอู่**: บันทึกข้อมูลลูกค้า, ข้อมูลรถยนต์, อาการแจ้งซ่อม พร้อมอัปโหลดภาพถ่ายสภาพรถก่อนซ่อม (Pre-inspection)
- **ควบคุมสถานะงานซ่อม 7 ขั้นตอน**: `รอตรวจเช็ค` ➔ `กำลังตรวจเช็ค` ➔ `กำลังซ่อม` ➔ `รออะไหล่` ➔ `ซ่อมเสร็จพร้อมส่งมอบ` ➔ `ส่งมอบแล้ว` ➔ `ยกเลิก`
- **จ่ายงานช่าง**: มอบหมายช่างผู้รับผิดชอบงานซ่อมแต่ละคันตามความชำนาญ
- **บันทึกปิดงานซ่อม**: แนบภาพถ่ายหลังซ่อมเสร็จ (Post-inspection), สรุปยอดเงินจริง, และระบุวันหมดอายุการรับประกัน

### 2) 🧾 ระบบเอกสาร & ชำระเงิน Dynamic PromptPay QR
- **ออกเอกสารอิเล็กทรอนิกส์**: สร้างใบเสนอราคา (Quotation) และใบแจ้งหนี้/ใบเสร็จรับเงิน (Invoice)
- **พิมพ์ A4 หน้าเดียว (Single-Page Isolated Print)**: ออกแบบหน้าพิมพ์แบบแยกเฉพาะเนื้อหาเอกสาร ข้อมูลเริ่มจากบนลงล่าง พอดี 1 หน้า A4 100%
- **Dynamic PromptPay QR Code**: คำนวณยอดเงินรวมสุทธิอัตโนมัติ และสร้าง QR Code ตามมาตรฐาน EMVCo ตามยอดเงินจริง ให้ลูกค้าสแกนจ่ายได้ทันที
- **ส่งเข้า LINE อัตโนมัติ**: มีปุ่ม `📲 ส่งเข้า LINE` ส่งการ์ดเอกสารใบเสนอราคาพร้อมยอดชำระไปยัง LINE ลูกค้าและแอดมินทันที

### 3) 📦 ระบบคลังสินค้า & ตัดสต็อกอะไหล่ (Inventory Management)
- **ฐานข้อมูลอะไหล่**: รหัสอะไหล่, ชื่อสินค้า, ราคาทุน, ราคาขาย, จำนวนคงเหลือ, และเกณฑ์แจ้งเตือนขั้นต่ำ
- **ตัดสต็อกแบบเรียลไทม์**: ตัดยอดสินค้าคงคลังทันทีเมื่อช่างบันทึกรายการอะไหล่เข้าใบสั่งซ่อม
- **แจ้งเตือนของใกล้หมด**: ส่งข้อความเตือนเข้า LINE แอดมินอัตโนมัติเมื่อจำนวนอะไหล่ลดลงถึงเกณฑ์

### 4) 💰 ระบบบัญชี & การเงิน (Finance & Analytics)
- **บันทึกรายรับ-รายจ่าย**: บันทึกรายรับค่างานซ่อม และรายจ่ายค่าจัดซื้ออะไหล่/ค่าใช้จ่ายทั่วไป
- **แดชบอร์ดสรุปผล**: รายรับรวม, รายจ่ายรวม, และกำไรสุทธิ
- **กราฟวิเคราะห์แนวโน้ม**: แสดงผลกราฟเปรียบเทียบรายได้และจำนวนงานซ่อมผ่าน Chart.js

### 5) ⏱️ ระบบเช็คชื่อ & คำนวณค่าจ้างช่าง (Attendance & Payroll)
- **บันทึกเวลาเข้างานช่าง**: มาตรงเวลา, สาย, ลาป่วย, ลากิจ, ลาพักร้อน, ขาดงาน
- **คำนวณค่าจ้างสะสมอัตโนมัติ**: รองรับทั้งช่าง **รายวัน** (คิดตามวันที่มาทำงานจริง) และช่าง **รายเดือน** (หักวันที่ขาดงานตามสัดส่วน)
- **สั่งเช็คชื่อผ่าน LINE**: แอดมินสามารถพิมพ์คำสั่ง เช่น `เช็คชื่อ สมศักดิ์ มา` ผ่านแชท LINE ได้ทันที

### 6) 🤖 ระบบสื่อสาร LINE Messaging & Chatbot 24 ชั่วโมง
- **Push Notification**: ส่งข้อความแจ้งเตือนอัตโนมัติเมื่อรับรถเข้า และเมื่อซ่อมเสร็จพร้อมส่งมอบ
- **Webhook Chatbot**:
  - ลูกค้าพิมพ์ `สถานะ` หรือเลขทะเบียน ➔ บอทรายงานสถานะงานซ่อมปัจจุบัน
  - ลูกค้าพิมพ์ `พร้อมเพย์` หรือ `โอนเงิน` ➔ บอทส่งยอดเงินและเลขบัญชีอู่
  - ลูกค้าพิมพ์ `ติดต่อ` / `แผนที่` ➔ บอทส่งเบอร์โทรและพิกัด Google Maps
  - แอดมินพิมพ์ `สรุป` / `รถในอู่` / `อะไหล่` ➔ บอทส่งข้อมูลสรุปหลังบ้านให้เฉพาะแอดมิน (แยกสิทธิ์ความปลอดภัย)
- **Rich Menu**: เมนูกด 6 ช่องมาตรฐานหน้าแชท

### 7) 🛡️ ระบบความปลอดภัย & สำรองข้อมูล (Security & Governance)
- **Role-Based Access Control (RBAC)**: เจ้าของร้าน (Owner) เข้าถึงได้ทุกเมนู ส่วนช่าง (Mechanic) เห็นเฉพาะงานที่ตนเองดูแล
- **การเข้ารหัสผ่าน**: Hash รหัสผ่านด้วยอัลกอริทึม **Bcrypt** ก่อนจัดเก็บบนฐานข้อมูล
- **Web Security**: ป้องกันช่องโหว่ด้วย Helmet Headers และ Rate Limiting ป้องกันการยิงสแปมคำร้องขอ
- **สำรองฐานข้อมูล**: ระบบ Export และ Import ไฟล์สำรองข้อมูล `.sql` ได้จากหน้าตั้งค่าระบบ

---

## 3. สเป็คระบบและความต้องการขั้นต่ำ (System Requirements)

### 3.1 ฝั่งเซิร์ฟเวอร์ (Server Requirements)

| รายการ | ความต้องการขั้นต่ำ (Minimum) | ความต้องการที่แนะนำ (Recommended) | สภาพแวดล้อมที่พัฒนาจริง (Current Testbed) |
| :--- | :--- | :--- | :--- |
| **CPU** | 1 Core (1.5 GHz ขึ้นไป) | 2 Cores ขึ้นไป (2.0 GHz) | Intel / AMD x64 Multi-core |
| **RAM** | 1 GB | 2 GB - 4 GB | 8 GB - 16 GB |
| **Storage** | 10 GB (SSD แนะนำ) | 20 GB ขึ้นไป (SSD) | SSD (จัดเก็บไฟล์รูปภาพและ SQL) |
| **ระบบปฏิบัติการ (OS)** | Windows 10/11 หรือ Ubuntu 20.04+ | Ubuntu 22.04 LTS หรือ Debian 12 | Windows 11 Pro 64-bit |
| **Node.js Runtime** | Node.js v18.x LTS | Node.js v20.x หรือ v22.x LTS | Node.js v24.13.0 |
| **Database Server** | MariaDB 10.5+ หรือ MySQL 8.0+ | MariaDB 10.11+ หรือ MySQL 8.0+ | MariaDB 10.11.11 |
| **Network** | อินเทอร์เน็ตความเร็ว 10 Mbps | อินเทอร์เน็ตความเร็ว 50 Mbps+ (มี Domain/HTTPS) | เครือข่ายรองรับ HTTPS สำหรับ Webhook |

### 3.2 ฝั่งผู้ใช้งาน / เครื่องลูกข่าย (Client Requirements)

| อุปกรณ์ | ความต้องการขั้นต่ำ | ซอฟต์แวร์ / เบราว์เซอร์ที่รองรับ |
| :--- | :--- | :--- |
| **คอมพิวเตอร์ / แล็ปท็อป** | RAM 2 GB, จอแสดงผล 1024x768 | Google Chrome 90+, Microsoft Edge, Firefox, Safari |
| **สมาร์ตโฟน / แท็บเล็ต** | RAM 2 GB ขึ้นไป (Android / iOS) | Chrome Mobile, Safari Mobile, หรือแอปพลิเคชัน LINE |
| **แอปพลิเคชัน LINE** | LINE เวอร์ชัน 10.0 ขึ้นไป | รองรับ Rich Menu และ Flex Message |

---

## 4. ส่วนประกอบของระบบ (Libraries, Dependencies & Sources)

### 4.1 ไลบรารีฝั่งเซิร์ฟเวอร์ (Backend Dependencies - Node.js)
ติดตั้งผ่าน **npm (Node Package Manager)** จากแหล่งข้อมูลทางการ [npmjs.com](https://www.npmjs.com/):

| ชื่อแพ็กเกจ (Package) | เวอร์ชันที่ใช้ | แหล่งที่มา | หน้าที่การทำงานในระบบ (Purpose) |
| :--- | :---: | :---: | :--- |
| **`express`** | `^4.19.2` | npmjs.com | เว็บเซิร์ฟเวอร์เฟรมเวิร์กหลัก จัดการ Routing, Middleware, และ HTTP Request/Response |
| **`ejs`** | `^3.1.10` | npmjs.com | Template Engine ประมวลผลและผสานข้อมูลร่วมกับ HTML แสดงผลแบบ Dynamic Webpage |
| **`mysql2`** | `^3.10.1` | npmjs.com | ไดรเวอร์เชื่อมต่อฐานข้อมูล MariaDB/MySQL รองรับ Connection Pool และ Promises |
| **`bcryptjs`** | `^2.4.3` | npmjs.com | อัลกอริทึมเข้ารหัสผ่านทางเดียวแบบ Salted Hash เพื่อความปลอดภัยของข้อมูลผู้ใช้ |
| **`express-session`** | `^1.18.0` | npmjs.com | จัดการ State และ Session ตรวจสอบสิทธิ์การเข้าสู่ระบบ (RBAC) |
| **`helmet`** | `^8.3.0` | npmjs.com | ตั้งค่า HTTP Security Headers ป้องกันช่องโหว่ทางเว็บ (XSS, Clickjacking) |
| **`express-rate-limit`**| `^8.6.0` | npmjs.com | ควบคุมอัตราการส่งคำร้องขอ ป้องกันการยิงสแปม (DDoS / Brute-force Attack) |
| **`multer`** | `^1.4.5-lts.1`| npmjs.com | มิดเดิลแวร์สำหรับอัปโหลดไฟล์ จัดการบันทึกภาพถ่ายสภาพรถก่อนและหลังซ่อม |
| **`promptpay-qr`** | `^0.5.0` | npmjs.com | สร้าง Payload ข้อมูลการชำระเงินตามมาตรฐานสากล EMVCo QR Code ของไทย |
| **`qrcode`** | `^1.5.4` | npmjs.com | แปลง Payload เป็นภาพ QR Code ในรูปแบบ Data URL (Base64) บนใบเสร็จ |
| **`dotenv`** | `^16.4.5` | npmjs.com | โหลดค่าคอนฟิกจากไฟล์ `.env` เช่น พอร์ต, รหัสผ่านฐานข้อมูล, LINE Tokens |

---

### 4.2 ส่วนประกอบฝั่งผู้ใช้งาน (Frontend Components)
เรียกใช้งานผ่านเครือข่ายส่งมอบข้อมูล **CDN (Content Delivery Network)**:

| ชื่อเครื่องมือ | เวอร์ชัน | แหล่งที่มา (CDN Provider) | หน้าที่การทำงานในระบบ (Purpose) |
| :--- | :---: | :---: | :--- |
| **Bootstrap** | `5.3.3` | jsDelivr CDN | CSS Framework หลัก สำหรับจัดการ Grid System, Layout, Modal, Forms แบบ Responsive |
| **Font Awesome** | `6.4.0` | cdnjs CDN | ไอคอนสัญลักษณ์เวกเตอร์ระดับมืออาชีพ ใช้ตกแต่งปุ่ม สถานะ และเมนูต่างๆ |
| **Chart.js** | `Latest` | cdnjs CDN | ไลบรารีสร้างกราฟวิเคราะห์รายรับ-รายจ่าย และสถิติจำนวนงานซ่อม |
| **Google Fonts** | Kanit / Prompt | Google Fonts API | ฟอนต์ภาษาไทยสไตล์โมเดิร์น สวยงาม อ่านง่าย สบายตาบนทุกอุปกรณ์ |

---

### 4.3 บริการภายนอก & เครื่องมือสนับสนุน (External Services & Dev Tools)

| เครื่องมือ / บริการ | ผู้ให้บริการ / แหล่งที่มา | หน้าที่การทำงานในระบบ (Purpose) |
| :--- | :---: | :--- |
| **LINE Messaging API** | LINE Corporation ([LINE Developers](https://developers.line.biz/)) | บริการ API สำหรับส่ง Push Notification, Flex Message และรับ Webhook Chatbot |
| **LINE Official Account** | LINE Corporation ([LINE OA Manager](https://manager.line.biz/)) | บัญชีทางการของอู่ สำหรับสร้าง Rich Menu 6 ช่อง และสื่อสารกับลูกค้า |
| **EMVCo PromptPay Standard** | ธนาคารแห่งประเทศไทย / PromptPay | มาตรฐานโครงสร้างข้อมูล QR Code สำหรับโอนเงินผ่านระบบพร้อมเพย์ |
| **MariaDB Server** | MariaDB Foundation ([mariadb.org](https://mariadb.org/)) | ระบบจัดการฐานข้อมูลเชิงสัมพันธ์ Open Source ประสิทธิภาพสูง |
| **Git & GitHub** | GitHub Inc. ([github.com](https://github.com/)) | ระบบควบคุมเวอร์ชันโค้ด (Version Control System) สำหรับจัดเก็บและติดตามการพัฒนา |

---

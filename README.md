# Telegram Mini Chat

Telegram ichida ishlaydigan real-time chat Mini App.

## 1. Talablar
- Node.js 20+
- Telegram bot
- HTTPS domen (localhost Telegram Mini App uchun yetarli emas)

## 2. O'rnatish

```bash
npm install
copy .env.example .env
```

Linux/macOS:
```bash
cp .env.example .env
```

`.env` ichiga BotFather bergan tokenni yozing.

## 3. Ishga tushirish

```bash
npm start
```

Brauzerda:
`http://localhost:3000`

## 4. Telegramga ulash

BotFather orqali:
1. `/newbot` bilan bot yarating yoki mavjud botni tanlang.
2. `/mybots` -> bot -> Bot Settings -> Menu Button.
3. Mini App URL sifatida HTTPS manzilingizni kiriting:
   `https://YOUR-DOMAIN.example`
4. Yoki Main Mini App sifatida sozlang.

## 5. Muhim
Production uchun HTTPS kerak. Nginx/Caddy yoki hosting platformasidan foydalaning.

Backend Telegram Mini App initData imzosini tekshiradi. Foydalanuvchi Telegramdan tashqarida oddiy brauzerda ochsa, demo user ishlatiladi; productionda bu rejimni o'chirish tavsiya qilinadi.

## 6. Funksiyalar
- Telegram user ID orqali login
- Profil rasmi/username
- User qidirish
- Private chat
- Real-time Socket.IO xabarlar
- SQLite message history
- Online holat
- Responsive mobile UI

## 7. Keyingi bosqichlar
Productionda:
- Redis adapter (bir nechta server uchun)
- Push notifications
- Block/report
- Media upload
- Admin panel
- Rate limiting
- HTTPS reverse proxy

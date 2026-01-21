# Gravitee APIM Audit Viewer - Setup Guide

## 🚀 Sürətli Başlanğıc

### 1. Repository-ni Clone Edin

```bash
git clone <repository-url>
cd gravitee-audit-viewer
```

### 2. Dependencies Yükləyin

```bash
npm install
```

### 3. Environment Variables Konfiqurasiyası

```bash
# .env.example faylını kopyalayın
cp .env.example .env
```

**.env faylını redaktə edin:**

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# MongoDB Configuration
MONGO_HOST=x.x.x.x
MONGO_PORT=27017
MONGO_USERNAME=gravitee_apim
MONGO_PASSWORD=your_actual_password_here
MONGO_DATABASE=gravitee
MONGO_AUTH_SOURCE=admin

# Collections (optional)
MONGO_COLLECTION_AUDITS=apim_audits
MONGO_COLLECTION_USERS=apim_users
MONGO_COLLECTION_APIS=apim_apis
MONGO_COLLECTION_APPLICATIONS=apim_applications
```

### 4. Serveri Başladın

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

### 5. Brauzerdə Açın

```
http://localhost:3000
```

---

## 🐳 Docker ilə Quraşdırma

### 1. .env Faylını Hazırlayın

```bash
cp .env.example .env
nano .env  # və ya vim, code, vs.
```

### 2. Docker Container-i Başladın

```bash
docker-compose up -d
```

### 3. Logları İzləyin

```bash
docker-compose logs -f
```

### 4. Dayandırın

```bash
docker-compose down
```

---

## 🔒 Təhlükəsizlik

### ⚠️ Vacib Qeydlər:

1. **`.env` faylını heç vaxt Git-ə commit etməyin!**
   - `.gitignore`-da olduğundan əmin olun
   - Yalnız `.env.example` commit edilməlidir

2. **Güclü şifrə istifadə edin**
   - Production-da mütləq güclü şifrə
   - Şifrəni heç kimə göstərməyin

3. **MongoDB Access Control**
   - MongoDB-də user-ə yalnız lazımi hüquqlar verin
   - Read-only access kifayətdir (audit viewer üçün)

4. **Network Security**
   - Firewall konfiqurasiyası
   - VPN və ya private network istifadə edin

---

## 🔧 Troubleshooting

### Problem: "MONGO_USERNAME and MONGO_PASSWORD must be set"

**Həll:**
```bash
# .env faylının olduğundan əmin olun
ls -la .env

# .env faylında username və password-un doldurulduğunu yoxlayın
cat .env | grep MONGO_USERNAME
cat .env | grep MONGO_PASSWORD
```

### Problem: "MongoDB connection failed"

**Həll:**
1. MongoDB-nin işlədiyini yoxlayın
2. Host və port-un düzgün olduğunu yoxlayın
3. Username/password-un düzgün olduğunu yoxlayın
4. Network connectivity yoxlayın:
   ```bash
   telnet x.x.x.x 27017
   ```

### Problem: "Cannot find module 'dotenv'"

**Həll:**
```bash
npm install
```

---

## 📊 MongoDB Test

MongoDB bağlantısını test etmək üçün:

```bash
mongosh --host x.x.x.x --port 27017 \
  -u gravitee_apim \
  -p 'your_password' \
  --authenticationDatabase admin

# MongoDB shell-də:
use gravitee
show collections
db.apim_audits.countDocuments()
```

---

## 🆘 Kömək

Problemlə qarşılaşsanız:

1. Logları yoxlayın: `npm start` və ya `docker-compose logs -f`
2. `.env` faylını yoxlayın
3. MongoDB bağlantısını test edin

---

## 📝 Qeydlər

- Default port: `3000`
- MongoDB default database: `gravitee`
- Collections: `apim_audits`, `apim_users`, `apim_apis`, `apim_applications`
- Node.js versiyası: 18+ (tövsiyə: 22)

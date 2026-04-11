# 🩺 MedBuddy — Your Health Companion

> AI-powered medicine reminder & health monitoring system with multilingual support and family alerts.

---

## 🚀 Overview

**MedBuddy** is a smart healthcare assistant that helps patients manage medications efficiently.  
It ensures timely reminders, alerts caregivers when doses are missed, and provides health insights — all in the user’s preferred language.

---

## 🎯 Problem Statement

- Patients forget to take medicines on time  
- No centralized system for prescription tracking  
- Caretakers are unaware of missed doses  
- Language barriers for elderly users  
- Lack of simple and accessible health monitoring  

---

## 💡 Solution

MedBuddy solves this by:

- 📸 Extracting medicines from prescriptions  
- ⏰ Sending smart reminders  
- 🚨 Alerting caregivers if doses are missed  
- 🌍 Supporting multiple languages  
- 📊 Generating downloadable health reports  

---

## ✨ Features

### 📸 Prescription Upload
- Upload via file or camera  
- Extract medicine details automatically  
- Edit and verify medicines manually  
- Add medicine images for easy identification  

---

### ⏰ Smart Reminder System
- Custom time-based scheduling  
- Dynamic backend reminder engine  
- Tracks:
  - Taken ✅  
  - Missed ❌  

---

### 🚨 Family Alert System
- If patient doesn’t mark “Taken” within 2 minutes:
  - Caretaker is alerted via email  
- Includes:
  - Patient name  
  - Medicine details  
  - Missed time  

---

### 📩 Notification System
- Email reminders (HTML formatted)  
- WhatsApp alerts (via Twilio)  
- In-app notifications  

---

### 🌍 Multi-language Support
Supports:
- English 🇬🇧  
- Kannada 🇮🇳  
- Hindi 🇮🇳  

Applies to:
- UI  
- Emails  
- Reports  

---

### 📊 Health Reports
- Adherence percentage  
- Taken vs missed doses  
- Weekly summary  
- Downloadable PDF reports in user’s language  

---

### 📱 Mobile-first UI
- Bottom navigation bar  
- Fully responsive design  
- Camera support  
- Optimized for one-hand usage  

---

## 🏗️ Tech Stack

| Layer        | Technology |
|-------------|-----------|
| Frontend     | Lovable (React-based UI) |
| Backend      | Supabase |
| Database     | PostgreSQL |
| Storage      | Supabase Storage |
| Auth         | Supabase Auth |
| Notifications| Email (Nodemailer), Twilio |
| AI Logic     | Prescription parsing |

---

## 🔄 System Architecture

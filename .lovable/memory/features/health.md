---
name: Health Integration
description: Health Connect integration architecture with mock data layer for web and /health page
type: feature
---
- /health page shows steps, sleep, heart rate, calories with weekly charts
- Mock data layer (src/lib/healthService.ts) generates demo data for web
- isNativeHealthAvailable() returns false on web; future Capacitor plugin replaces it
- health_data table in Supabase stores synced summaries (patient_id + date unique)
- Connect/Disconnect flow with status badges
- Translations for all health UI keys in 8 languages

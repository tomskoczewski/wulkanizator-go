---
change_id: booking-flow-analysis
title: Deep Focus on the appointment booking flow (M4L3 analysis, no refactor)
status: preparing
created: 2026-09-12
updated: 2026-09-12
archived_at: null
---

## Notes

Analiza przepływu rezerwacji wizyty (Deep Focus, M4L3) — od NewAppointmentForm przez POST /api/appointments i services/appointments.ts do book_appointment() i constraintu appointments_no_overlap_per_bay. Cel: research.md z sekcjami "Feature overview" i "Technical debt", oparty na dowodach, bez projektowania refaktoru. Obszar wskazany przez context/map/repo-map.md jako strefa ryzyka #1 (jeden niezmiennik, dwie niezależne implementacje, nigdy nie zmieniane w jednym commicie).

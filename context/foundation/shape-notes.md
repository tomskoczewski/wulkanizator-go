---
project: "Wulkanizator GO"
context_type: greenfield
created: 2026-06-02
updated: 2026-06-02
version: 1
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "trójstronne: workflow friction (primary), data trapped, decision paralysis"
    - topic: "insight"
      decision: "istniejące systemy za skomplikowane, warsztaty nie szukają software'u, brak narzędzia z przechowalnią opon"
    - topic: "primary persona"
      decision: "właściciel małego warsztatu (1-5 stanowisk); secondary: pracownik"
    - topic: "auth strategy"
      decision: "login email + hasło; dwie role: właściciel (pełen dostęp) i pracownik (plan dnia + statusy)"
    - topic: "mvp flow"
      decision: "7 kroków: rejestracja warsztatu → usługi → plan dnia → dodanie wizyty → status → widok dnia"
    - topic: "timeline"
      decision: "3 tygodnie, praca po godzinach"
  frs_drafted: 10
  quality_check_status: accepted
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Warsztaty wulkanizacyjne zarządzają dniem pracy na Excelu i kartkach — brak przejrzystego planu dnia, brak śledzenia przechowalni opon, brak prognozy przychodów. W sezonie (wiosna/jesień) natłok telefonów i wizyt powoduje chaos w grafiku, pomylone terminy i brak wiedzy o statusie prac.

Istniejące systemy (ERP, CRM, kalendarze) są za skomplikowane dla warsztatu wulkanizacyjnego — mają za dużo funkcji, wymagają długiego wdrożenia. Właściciele warsztatów nie szukają software'u, bo przyzwyczaili się do kartek. Żaden kalendarz nie oferuje modułu przechowalni opon — specyfiki tej branży. Wulkanizator GO to system, który działa jak lista zadań na dziś: duże przyciski, proste statusy, minimum pól, start w 30 minut, pracownicy uczą się obsługi w 15 minut.

## User & Persona

### Primary persona
Właściciel małego warsztatu wulkanizacyjnego (1-5 stanowisk). Sam obsługuje klientów telefonicznie i osobiście, zarządza grafikiem, nadzoruje pracowników, przechowuje opony klientów. Sięga po system w momencie, gdy sezon się zaczyna i telefony nie przestają dzwonić — potrzebuje widzieć plan dnia bez Excela i kartek.

### Secondary persona
Pracownik warsztatu (mechanik/wulkanizator). Konsumuje plan dnia — potrzebuje wiedzieć, co ma zrobić, w jakiej kolejności, i oznaczyć status: oczekuje, w trakcie, gotowe, nie przyjechał.

## Access Control

Login email + hasło. Dwie role:
- **Właściciel** — pełen dostęp: plan dnia, ustawienia warsztatu (stanowiska, godziny pracy, usługi, cennik), baza klientów, przechowalnia opon, przychody i prognoza.
- **Pracownik** — ograniczony dostęp: plan dnia (wizyty przypisane do stanowiska), zmiana statusu wizyty, podgląd szczegółów wizyty. Brak dostępu do przychodów, cennika, ustawień warsztatu.

## Success Criteria

### Primary
- Właściciel może skonfigurować warsztat (stanowiska, godziny, usługi), dodać wizytę w kilkanaście sekund z podpowiedzią wolnych terminów, i zobaczyć plan dnia ze statusami wszystkich wizyt — cały MVP flow działa end-to-end.

### Secondary
- Przechowalnia opon: właściciel może przyjąć opony klienta i śledzić stan (kto ma opony, gdzie leżą).

### Guardrails
- Wizyty nie mogą się nakładać — system blokuje slot na podstawie czasu trwania usługi i stanowiska. Dwie wizyty na tym samym stanowisku w tym samym czasie to regresja gorsza niż kartki.
- Plan dnia musi być czytelny w 2 sekundy — jeden rzut oka i wiadomo co się dzieje. Jeśli trzeba szukać, to gorsze niż tablica.
- Dane klientów (telefony, auta) nie mogą wyciec — podstawowa prywatność danych osobowych.

## User Stories

### US-01: Właściciel dodaje wizytę do planu dnia

- **Given** zalogowany właściciel z skonfigurowanym warsztatem (stanowiska, godziny pracy, usługi z czasem trwania)
- **When** wybiera "dodaj wizytę", wskazuje usługę i dane klienta
- **Then** system podpowiada najbliższe wolne terminy na podstawie czasu trwania usługi, właściciel wybiera slot, wizyta pojawia się na planie dnia ze statusem "oczekuje", slot jest automatycznie zablokowany na stanowisku

#### Acceptance Criteria
- Dodanie wizyty trwa max kilkanaście sekund
- System podpowiada tylko wolne terminy (nie nakładające się z innymi wizytami na danym stanowisku)
- Wizyta od razu widoczna na planie dnia z poprawnym statusem

## Functional Requirements

### Konfiguracja warsztatu
- FR-001: Właściciel can zakłada konto warsztatu (nazwa, dane kontaktowe). Priority: must-have
  > Socrates: Counter-argument: "rejestracja wymaga za dużo danych i odstrasz przed startem." Resolution: kept; rejestracja musi być minimalna (nazwa, email, hasło), reszta danych w konfiguracji — nie blokować startu.

- FR-002: Właściciel can konfiguruje stanowiska i godziny pracy warsztatu. Priority: must-have
  > Socrates: Counter-argument: "konfiguracja jest za trudna i blokuje start." Resolution: kept; konfiguracja musi być prosta i szybka — obietnica "start w 30 min" jest obowiązująca.

- FR-003: Właściciel can dodaje usługi z czasem trwania (np. wymiana kół 30min, naprawa 20min). Priority: must-have
  > Socrates: Counter-argument: "stały czas trwania nie odzwierciedla rzeczywistości (SUV vs małe auto)." Resolution: kept; na MVP stały czas per usługa jest wystarczający, elastyczny czas (per typ auta) to ewentualnie v2.

### Plan dnia i wizyty
- FR-004: Właściciel can dodaje wizytę — wybiera usługę, podaje dane klienta, system podpowiada wolne terminy. Priority: must-have
  > Socrates: Counter-argument: "podpowiadanie terminów spowalnia dodawanie wizyty — klient czeka na telefonie." Resolution: kept; podpowiedzi muszą być natychmiastowe i nie mogą blokować flow. Rozważyć opcję "dodaj teraz" dla walk-in klientów.

- FR-005: System can automatycznie blokuje slot na stanowisku na podstawie czasu trwania wybranej usługi. Priority: must-have
  > Socrates: Counter-argument: "zbyt sztywne blokowanie — rzeczywistość jest elastyczna, usługa kończy się wcześniej lub później." Resolution: kept; automatyczne blokowanie jest core guardrail (zapobiega nakładaniu). Ręczny override do rozważenia w przyszłości.

- FR-006: Właściciel/Pracownik can widzi plan dnia ze wszystkimi wizytami i ich statusami w jednym widoku. Priority: must-have
  > Socrates: Counter-argument: "pracownik nie potrzebuje widzieć wszystkich stanowisk — chce widzieć SWOJE zadania." Resolution: kept; jeden widok jest default, filtrowanie per stanowisko do rozważenia, ale nie blokuje MVP.

- FR-007: Pracownik can zmienia status wizyty (oczekuje → w trakcie → gotowe / nie przyjechał). Priority: must-have
  > Socrates: Counter-argument: "pracownik zapomina zmieniać statusy (brudne ręce, nie sięga po telefon)." Resolution: kept; duże przyciski i prosty interface minimalizują barierę. Jeśli pracownik nie zmienia statusów, system traci wartość — ale to problem adopcji, nie FR.

- FR-008: Właściciel can widzi szczegóły wizyty po wejściu w konkretną wizytę. Priority: must-have
  > Socrates: Counter-argument: "za dużo szczegółów do wypełnienia zaprzecza 'minimum pól'." Resolution: kept; szczegóły wizyty = podgląd, nie formularz. Minimum pól przy dodawaniu, więcej informacji przy podglądzie.

### Klienci
- FR-009: Właściciel can zarządza bazą klientów — dodawanie, wyszukiwanie, karta klienta z telefonem i autem. Priority: must-have
  > Socrates: Counter-argument: "wymuszanie karty klienta spowalnia dodawanie wizyty dla jednorazowych klientów." Resolution: kept; wizyta musi być możliwa BEZ karty klienta (walk-in). Karta klienta to opcja, nie wymóg. Stały klient = karta, jednorazowy = imię + telefon.

### Przechowalnia opon
- FR-010: Właściciel can przyjmuje opony klienta do przechowalni i śledzi stan (kto, gdzie leżą). Priority: nice-to-have
  > Socrates: Counter-argument: "przechowalnia to osobny moduł, który komplikuje MVP i może przeciążyć 3-tygodniowy timeline." Resolution: kept as nice-to-have; ryzyko timeline'u uznane. Jeśli nie zmieści się w 3 tygodniach, zostaje na v2.

## Business Logic

System automatycznie podpowiada najbliższe wolne terminy na podstawie czasu usługi i dostępności stanowisk, a następnie prowadzi wizytę przez stany (oczekuje → w trakcie → gotowe / nie przyjechał), blokując i zwalniając sloty w grafiku.

Reguła recommendation: na wejściu — wybrana usługa (z czasem trwania), dzień, lista stanowisk z ich obłożeniem. Na wyjściu — posortowana lista najbliższych wolnych slotów, w których usługa się mieści bez nakładania z istniejącymi wizytami. Użytkownik widzi podpowiedzi przy dodawaniu wizyty — wybiera slot jednym kliknięciem.

Reguła workflow: wizyta przechodzi przez stany: oczekuje → w trakcie → gotowe / nie przyjechał. Każda zmiana statusu jest widoczna na planie dnia jako kolorowy kafelek. Przejście "nie przyjechał" zwalnia slot, ale nie kasuje wizyty z historii.

## Non-Functional Requirements

- Plan dnia i jego aktualizacje są widoczne w mniej niż 2 sekundy od otwarcia aplikacji lub zmiany statusu.
- Aplikacja pozostaje użyteczna na ekranach od telefonu (360px) po tablet/laptop — pracownik przy stanowisku używa telefonu, właściciel tabletu lub laptopa.
- Dane klientów (telefony, numery rejestracyjne, dane aut) są chronione zgodnie z RODO baseline — nie wyciekają, nie są dostępne publicznie, dostęp tylko po zalogowaniu w ramach danego warsztatu.
- System jest dostępny i działa niezawodnie w godzinach pracy warsztatu (typowo 7:00–18:00, pon-sob) — awaria w sezonie oznacza utracone wizyty i powrót do kartek.

## Non-Goals

- Brak natywnej aplikacji mobilnej (iOS/Android) — MVP to web app responsywna. Natywna aplikacja to scope na późniejszy etap.
- Brak integracji z księgowością / fakturami — system pokazuje cennik i prognozę przychodów, ale nie generuje faktur ani nie integruje się z programami księgowymi.
- Brak powiadomień SMS/email do klientów — system nie wysyła przypomnień o wizycie ani potwierdzeń. To wymaga integracji z bramką SMS/email i komplikuje MVP.
- Brak multi-tenant (wiele warsztatów na jednym koncie) — jedno konto = jeden warsztat. Zarządzanie siecią warsztatów to nie-MVP.

## Forward: tech-stack

Użytkownik wspomniał w notatkach: "aplikacja w wersji MVP webowa, ale chciałbym żeby też w dalszym etapie przejść na mobilki." To informacja dla downstream tech-stack selection — nie jest częścią PRD.

## Quality cross-check

All elements present. No gaps detected. Status: accepted.

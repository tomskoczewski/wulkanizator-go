---
title: Raport architektoniczny — moduł 4 (10xArchitect)
author: tomaszskoczewski
date: 2026-09-13
repo: wulkanizator-go
commit: eff88b0
---

# Raport architektoniczny — moduł 4

Każda liczba pochodzi ze wskazanego artefaktu, nie z pamięci o kodzie.

## 1. Opisane projekty

Wszystkie cztery artefakty powstały na **jednym repozytorium**.

|               |                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repo**      | `wulkanizator-go` — „plan dnia" warsztatu wulkanizacyjnego: konfiguracja stanowisk/usług/godzin, rezerwacja z podpowiedzianych terminów, tablica statusów wizyt   |
| **Stack**     | Astro 7 SSR + React 19 (wyspy), Tailwind 4, Supabase (Postgres + Auth + RLS), Cloudflare Workers; Vitest, Playwright, pgTAP                                       |
| **Skala**     | 73 pliki źródłowe (12 route'ów API, 14 `.astro`), 109 commitów w 3 miesiące, **jeden autor**, zero recenzji ludzkich                                              |
| **Artefakty** | L2 `map/repo-map.md` · L3 `changes/booking-flow-analysis/research.md` · L4 `changes/refactor-opportunities/plan.md` · L5 `domain/01…03…` — wszystkie w `context/` |

## 2. Mapa projektu (L2)

Cała praca leży w jednej pionowej ścieżce — rezerwacji wizyty: `lib/services`, `lib/schemas`,
`pages/api` i `components/appointments` to 32% dotknięć kodu, a MVP powstał w miesiąc. Stamtąd cztery
wnioski:

1. **Strefa ryzyka #1: reguła „brak dwóch wizyt na jednym stanowisku" istnieje dwa razy** — w TS i
   jako ograniczenie wykluczające w Postgresie — a **żaden commit nigdy nie zmienił obu stron naraz**.
2. **Naiwny czas warsztatowy trzyma się na samej konwencji**: jeden moduł, zero testów i reguł
   lintera — jedno `getHours()` przywraca strefę hosta.
3. **Wejścia płytkie, centrum jedno**: 12 route'ów API to liście grafu (identyczny kształt, fan-in
   0), a ciężar pionu leży w `services/appointments.ts` (375 linii, hub rezerwacji) i `types.ts`
   (54 linie, 25 importerów).
4. **Dwa ograniczenia są same w sobie wnioskami**: depcruise nie parsuje 14 z 73 plików (`.astro`),
   więc każdy fan-in to **dolne ograniczenie**; a przy 109/109 commitach od jednej osoby „kogo
   zapytać" znaczy „który trwały zapis to mówi".

## 3. Analiza ficzera (L3)

**Co i dlaczego.** Ścieżka rezerwacji, od formularza po funkcję zapisu w Postgresie — bo mapa nazwała
ją strefą ryzyka #1. Wyspa React pyta o wolne terminy; serwis czyta RLS-owane wiersze (usługa,
stanowiska, godziny pracy, wizyty w horyzoncie 14 dni) i przejściem po 15-minutowej siatce zwraca
maks. 6 slotów. Przy zapisie serwer **nie ufa klientowi**: przelicza listę i wymaga, by para
`(bay_id, starts_at)` nadal na niej była, a `ends_at` wyprowadza z serwerowego `duration_min` — pola
tego nie ma w schemacie żądania. Postgres odpowiada wyłącznie za wyścig, a route zwraca `409` ze
świeżo przeliczoną listą terminów.

**Trzy najważniejsze długi:**

- **TD-1 — wspólna reguła napisana dwa razy, nigdy nie edytowana razem.** Obie strony łączy
  **jeden token runtime'owy**: literał `"23P01"` (`ast-grep`: 2 wystąpienia w jednym pliku), a
  `comm -12` po commitach `slot-suggestions.ts` i `supabase/migrations/` daje **zbiór pusty**.
  Rozjazd zawodzi albo _otwarcie_ (slot, który baza odrzuca), albo _cicho_.
- **TD-2 — sześć reguł (godziny pracy, dzień zamknięty, siatka, przeszłość, horyzont, długość wizyty)
  żyje tylko w nietestowanym preflighcie TS, bez backstopu w bazie**: usunięcie preflightu zostawia
  cały suite zielony.
- **TD-4 — submit rezerwacji omija wspólną ścieżkę HTTP.** `ast-grep` po `fetch($$$)` nad `src`
  zwraca **dokładnie dwa** miejsca: współdzielony hook i ten submit (zero backstopowane grepem
  po `.astro`).

## 4. Plan refaktoryzacji (L4)

**Refaktoryzuję TD-4: złożenie submitu na współdzielony `requestJson`** — w `src/` zostaje **jedno**
wywołanie `fetch`, a submit rozgałęzia się na `MutationResult`, nie na surowy `Response`. Wybór jest
historyczny, nie estetyczny: obejście przyjęto świadomie w review, bo typ porażki hooka nie mieścił
payloadu `409` — a późniejszy commit dodał do niego `status` i `body`, **unieważniając to
uzasadnienie**. Szwem jest bezstanowy `requestJson`, nie hook `useJsonMutation`, który wypycha
porażkę do stanu Reacta — nieodczytywalnego po `await`.

**Czego świadomie NIE robię:** deduplikacji reguły nienakładania (dublowanie zaprojektowano jako
obronę warstwową), ograniczeń w bazie dla reguł z TD-2 (osobna decyzja), podziału `appointments.ts`,
zmian we współdzielonych hookach ani tłumaczenia stringów API.

| Faza | Jedno zdanie                                                                        | Weryfikacja                                                                    |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | Test przypina trzy dzisiejsze ścieżki (`201`, `409`, sieć) **przed** zmianą kodu    | auto: test/typecheck/lint · **ręcznie**: zepsucie gałęzi musi wywalić jej test |
| 2    | Podmiana `fetch` na `requestJson`, zachowanie bez zmian                             | auto: testy Fazy 1 zielone **bez edycji pliku testowego**, `ast-grep`, build   |
| 3    | `400` pokazuje komunikat per-pole, `500`/`503` polski generyk, nie angielski string | auto: dwa nowe przypadki · ręcznie: zatrzymany stack pokazuje generyk          |
| 4    | Playwright w CI jako osobny job (klucze derywowane z `supabase status`)             | auto: job zielony na pushu · ręcznie: zepsuty spec czerwieni job               |

## 5. Domena wg DDD (L5)

**Ubiquitous language** (23 terminy): _warsztat_ (tenant — jedno konto = jeden warsztat), _stanowisko_
(`bay`, zasób który wizyta zajmuje), _usługa_ (`duration_min`), _wolny termin_ (`SuggestedSlot`),
_wizyta_ (`appointment` ze statusem). Rozjazdy model↔kod: **(D2)** nic w kodzie nie potrafi anulować
wizyty, choć PRD nazywa anulowanie stanem terminalnym; **(D3)** API przyjmuje _dowolną_ parę statusów
zamiast udokumentowanej ścieżki; **(D10, odwrotnie)** reguła „ten sam telefon = ten sam klient" (próg
9 cyfr, wygrywa najstarsze imię) żyje **wyłącznie w SQL-u**.

**Niezmiennik #1 i agregat.** Niezmiennik jest **złożony** — cztery klauzule jednego zapisu: _wizyta
zajmuje slot, który warsztat faktycznie może obsłużyć_ (aktywne stanowisko własnego warsztatu, czas
trwania usługi, okno godzin pracy, brak nakładania) — a siedzą na **trzech wysokościach
egzekwowania**: nakładanie jest szczelne w bazie, czas trwania i godziny pracy nie mają **nic**
poniżej warstwy aplikacji, a własność warsztatu jest sprawdzana na jednych drzwiach zapisu z dwojga
(`grant insert … to authenticated` to drugie — znalezisko nieobecne we wcześniejszych artefaktach).
Agregat: **`WorkshopSchedule`** z korzeniem w funkcji `security definer`, bo granicą zaufania jest
PostgREST. Sedno jest **odejmujące**: `p_ends_at` staje się derywacją z `services.duration_min`, więc
zły czas trwania jest _niewyrażalny_, a preflight spada do roli udogodnienia UX.

**ACL.** Przecieka **wygenerowany schemat PostgREST**, pod cudzym nazwiskiem: grep po `@supabase/*`
zwraca **2 pliki**, więc SDK wygląda na odizolowany. Właściwy pomiar to grep po słowniku kolumn —
**93 linie kodu, 25 plików, 6 warstw z 6**, aż po **8 z 11 odpowiedzi JSON w `src/pages/api/`, które
są surowym wierszem PostgREST**; `npm run db:types` jest więc krokiem nośnym w kontrakcie HTTP.

## 6. Decyzje, które należą do mnie

Jednej oceny agenta nie kupiłem: uznał pewien dług za przypadkowy tylko dlatego, że nikt o nim nigdy
nie napisał, a cisza w dokumentacji to dla mnie za mało. Kolejność obroniłem własnym kryterium:
najpierw to, co jest już przemyślane, a nie to, co wygląda najgroźniej. Dlatego problem numer jeden z mapy
zostawiłem w spokoju, bo po sprawdzeniu okazał się celowym zabezpieczeniem, a nie bałaganem.
Najciekawsze były dwa momenty, kiedy agent miał rację przeciwko mnie: obie rzeczy, które sam
wpisałem do planu, z niego wypadły, bo źle oceniłem, co naprawdę jest zagrożone. Wydawało mi się na
przykład, że projekt jest luźno związany z bazą danych, a okazało się, że nazwy jej kolumn
przewijają się przez całą aplikację i wychodzą aż do przeglądarki.

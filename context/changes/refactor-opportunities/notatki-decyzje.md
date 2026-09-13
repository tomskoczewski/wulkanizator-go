# Notatki decyzyjne — checkpoint ludzki (Faza 8)

> Surowiec na sekcję 6 raportu architektonicznego („Decyzje, które należą do mnie").
> Zapis przeglądu z 2026-09-13. Odpowiedzi są moje; agent pełnił rolę pytającego i protokolanta.
> Plik rośnie — Fazy 10, 11 i 12 dopisały swoje sekcje.

## ① Audyt listy kandydatów

**Werdykt: lista kompletna, klasyfikacja kupiona.**

Sprawdzone: wszystkie osiem pozycji _Technical debt_ z analizy L3 ma przypisanie — TD-1→K1,
TD-2→K2, TD-3→N1, TD-4→K4, TD-5→K3 i N2, TD-6→K6, TD-7→N3, TD-8→N4. Nic nie wypadło po drodze.

Kupuję też sam podział. Test „czy naprawa zmienia kształt kodu?" jest właściwym kryterium i dzieli
listę bez naciągania: sześć kandydatów do refaktoryzacji, sześć pozycji, które są brakującym testem
(N1, N2), podejrzanym defektem (N3), jedną brakującą gałęzią (N4), dryfem reguł względem
dokumentacji (N5) albo rzeczą już zmechanizowaną (N6). Rozważałem, czy N3 i N5 nie zasługują na
własny tor — uznałem, że nie na tym etapie: to osobne decyzje, nie kandydaci do refaktoru.

## ② Werdykty intencjonalności — gdzie dowód, a gdzie przeczucie

**Werdykt: jeden werdykt odrzucam jako nieugruntowany — K5.**

`UNKNOWN, leaning accidental` nie jest werdyktem, tylko przyznaniem się do jego braku. Oznaczenie
`[E]/[U]` mówi to wprost, a uzasadnienie („żaden change folder nie nazywa `types.ts` przedmiotem
zmiany") jest argumentem z milczenia. Dopóki nie ma dowodu, K5 nie może ważyć w rankingu — i dobrze,
że nie waży.

Pozostałe pięć uznaję za dostatecznie ugruntowane. Najmocniejszy jest K4: opiera się na konkretnym
zapisie (`impl-review.md` F3) plus konkretnym commicie, który to uzasadnienie unieważnił (`be9ece7`)
— to nie interpretacja, to ślad w historii. K1 stoi na `plan-brief.md` S-02, l. 59–62, gdzie
dublowanie jest zaprojektowane wprost. K6 ma najlepszy możliwy dowód: rutynę, którą widać w każdym
planie dotykającym pgTAP.

## ③ Ranking

**Werdykt: kupuję kolejność K4 → K2 → K1 bez zmian.**

Nic bym nie przesuwał. Rozważałem dwie alternatywy i obie odrzuciłem:

- **K2 przed K4** — sześć reguł bez backstopu w bazie to obiektywnie większe ryzyko produkcyjne niż
  jeden obejście transportu. Ale ryzyko nie jest jedynym kryterium kolejności: K4 jest jedynym
  kandydatem, którego uzasadnienie **prowadnie wygasło**, więc decyzja jest już podjęta i wystarczy
  ją wykonać. K2 wymaga najpierw decyzji, których reguł faktycznie chcę pilnować w bazie.
- **K1 przed K2** — to strefa ryzyka #1 z mapy repo. Ale werdykt intencjonalności mówi DELIBERATE:
  dublowanie jest zaprojektowaną obroną warstwową, nie długiem. Cofanie cudzej świadomej decyzji
  bez nowego dowodu byłoby najgorszym rodzajem refaktoru.

Zasada, którą tu stosuję: **kolejność rządzi się decydowalnością, nie samym rozmiarem ryzyka.**
Najpierw to, co jest już rozstrzygnięte i da się wykonać wąsko.

## Decyzje podjęte przy planowaniu i review (Faza 9)

Zapis chronologiczny — do wykorzystania w sekcji 6.

1. **Wybór kandydata: K4, nie K2.** Wąski wycinek z gotowym dowodem przed ryzykowniejszą pracą
   schematową.
2. **Seam: `requestJson`, nie `useJsonMutation`.** Hook oddaje błąd do stanu Reacta, którego wołający
   nie odczyta po `await`. Bezstanowy `requestJson` zwraca komplet synchronicznie.
3. **Nie ruszam współdzielonych hooków.** Siedmiu innych wołających; rozszerzanie hooka pod jednego
   użytkownika to spekulacja.
4. **Playwright do CI — wbrew ostrzeżeniu**, że poszerza celowo wąski wycinek. Siatka bezpieczeństwa,
   na której stoi cała zmiana, dziś nie uruchamia się automatycznie. Faza 4 jest ostatnia i odwracalna
   osobno, żeby Fazy 1–3 weszły niezależnie od jej losu.
5. **Klucze Supabase w CI: derywacja z uruchomionego stacka, nie wpisanie JWT do repo** (F2 review).
   Odrzucona alternatywa kusiła prostotą, ale przypina klucz, który CLI może zmienić.
6. **Fazę 3 zostawiam mimo że jej efekt jest dziś nieosiągalny z UI** (F3 review). Schemat waliduje
   telefon i imię przez `.min(1)`, czyli dokładnie to, co `canSubmit` już blokuje — więc żaden
   wpisywalny input nie wyprodukuje 400. Zostawiam jako zabezpieczenie na pierwsze zaostrzenie
   schematu, ale **nazywam to wprost w planie**, żeby nikt nie szukał zmiany widocznej dla użytkownika.

## Do rozstrzygnięcia

- **Werdykt K3 (`ACCIDENTAL`)** wyprowadzono z nieobecności planu w dziewięciu archiwalnych zmianach.
  Review podniosło, że to również argument z milczenia — tej samej klasy co odrzucony K5. Nie
  rozstrzygnąłem tego w tym przeglądzie; jeśli werdykt K3 jest słaby, to jego pozycja poza rankingiem
  wymaga innego uzasadnienia niż „intencjonalne".

## Zaskoczenie z destylacji domeny (Faza 10)

Zaskoczyło mnie, że decyzja „ten sam telefon = ten sam klient" — z progiem 9 cyfr, poniżej którego
przestaje obowiązywać, i z regułą „wygrywa najstarsze imię" — żyje wyłącznie w migracji
(`supabase/migrations/20260825120000_customer_phone_dedupe.sql:35-50,110-112` i
`20260825120100_book_appointment_dedupe_customer.sql:60-84`), a model milczy: PRD nigdzie nie mówi,
kiedy dwie wizyty należą do tego samego klienta. To reguła tożsamości bytu domenowego, podjęta przy
okazji naprawy buga, zapisana w SQL-u i w `lessons.md` — nie w dokumencie, który miałby o niej
decydować.

## Wybór niezmiennika #1 (Faza 11)

**Werdykt: kupuję wybór agenta, łącznie z odejściem od kandydata, którego sam wpisałem do planu.**

Mój plan fazy wskazywał „silnego kandydata": regułę o nienakładaniu się wizyt na tym samym
stanowisku, jako klasycznie rozsmarowaną po warstwach (wyliczanie slotów + ograniczenie w bazie).
Agent jej nie wybrał — i ma rację. Overlap jest z całej reguły egzekwowany **najlepiej**: constraint
wykluczający w Postgresie jest autorytatywny, a dwie warstwy nad nim są świadomą obroną warstwową,
nie długiem (to zresztą mój własny werdykt `DELIBERATE` dla K1 z sekcji ③ powyżej). Rozsmarowanie
bez słabego egzekwowania nie czyni niezmiennika groźnym.

Kupuję też, że wybrany niezmiennik jest **złożony**, a nie pojedynczy. Cztery klauzule — stanowisko
własnego warsztatu, czas trwania usługi, okno godzin pracy, brak nakładania — dotyczą jednego
obiektu i jednego zapisu, ale siedzą na trzech różnych wysokościach egzekwowania. Wybranie jednej
klauzuli dałoby agregat pilnujący ćwiartki reguły. Mapa ryzyk mówi to samo od początku: ryzyko #2 w
`test-plan.md:46` opisuje podwójną rezerwację i termin poza godzinami pracy jako **jedną** awarię.

Najmocniejszy pojedynczy dowód, który przeważył: **dwoje drzwi do zapisu wizyty, nie jedne.**
`grant insert on public.appointments to authenticated` plus polityka sprawdzająca wyłącznie
`workshop_id` i rolę oznaczają, że naprawę findingu F1 z impl-review (migracja
`20260821150000_book_appointment_ownership_check.sql`) nałożono na jedne drzwi z dwojga. Tego nie
było w żadnym wcześniejszym artefakcie — ani w analizie L3, ani w destylacji domeny — a sam pgTAP
przechodzi tymi drugimi drzwiami jako ścieżką legalną (`rls_workshop_scope.test.sql:730-741`).

Drugi kandydat z mojego planu — naiwny czas warsztatowy pilnowany konwencją zamiast typem —
zostawiam odrzucony z uzasadnieniem, które kupuję: to problem systemu typów, nie agregatu, i właściwą
odpowiedzią jest typ znakowany, a nie obiekt-strażnik.

## Zaskoczenie i werdykt z ACL (Faza 12)

**Zaskoczenie: kryterium sukcesu z lekcji przechodzi na zielono, a przeciek ma sześć warstw.**

Lekcja każe sprawdzić izolację greptem po nazwie pakietu. Dla `@supabase/*` ten grep zwraca **dwa
pliki** (`src/lib/supabase.ts:1`, `src/env.d.ts:3`) — czyli formalnie SDK jest już odizolowany i
temat wygląda na zamknięty. Nie jest. Zależność podróżuje pod innym nazwiskiem: `db/database.types.ts`
→ `src/types.ts:18-26`, gdzie osiem wierszy tabel i enumów zostaje re-eksportowanych jako słownik
domenowy projektu, a stamtąd wchodzi w propsy islandów, `useState`, body requestów i body
odpowiedzi. **93 linie kodu aplikacji mówią nazwami kolumn bazy, przy 2 liniach nazywających sam
pakiet.** Sześć warstw z sześciu, 25 plików produkcyjnych.

Wniosek, który biorę na własność: **grep po nazwie pakietu mierzy import, nie sprzężenie.** Kiedy
zależność ma generator (`npm run db:types`), jej kształt rozchodzi się przez wygenerowany artefakt,
a nie przez `import`. Kryterium trzeba było przedefiniować — pięć greptów zamiast jednego, i to ten
po słowniku kolumn (93) jest właściwym pomiarem, nie ten po nazwie pakietu (2).

**Werdykt: kupuję wybór #1 wbrew obu kandydatom, których sam wpisałem do planu fazy.**

Wpisałem `@supabase/*` albo natywny `Date`. Wygrało coś trzeciego — wygenerowany schemat PostgREST —
i uzasadnienie kupuję na obu osiach, na których moi kandydaci przegrywają:

- `@supabase/*` przegrywa, bo mierzony po nazwie już jest szczelny; to jego _typy_, nie import,
  są przeciekiem.
- `Date` przegrywa, bo **nie jest zależnością, którą się wymienia**. ACL opłaca się wtedy, gdy
  „biblioteka się zmienia → zmienia się jeden katalog"; `Date` nie ma następcy. To ten sam werdykt,
  który podjąłem w Fazie 11 dla kandydata nr 2 (typ znakowany, nie obiekt-strażnik) — i dobrze, że
  plan ACL nie robi z niego osobnego refaktoru, tylko wciąga go jako `NaiveWallClock` do value
  objectów.

**Rzecz, którą odnotowuję jako niewygodną dla własnej narracji:** jedyna obietnica izolacji zapisana
w tym repo na piśmie dotyczy właśnie `Date` (`AGENTS.md:14`, „workshop-clock.ts jest jedynym modułem
uprawnionym…") — i jest złamana w czterech miejscach, w tym w React islandzie
(`DayPlanBoard.tsx:48`). Wymienialności Supabase **nikt nigdzie nie obiecał**; `tech-stack.md:24`
wybrał to sprzężenie świadomie, pod trzytygodniowy termin. Czyli oś „rozjazd intencja-vs-kod", którą
lekcja traktuje jako mocny sygnał, wskazuje na kandydata, który nie jest #1. Uzasadnienie dla #1
musi stać na szkodzie tu i teraz — i stoi: **8 z 11 odpowiedzi JSON w `src/pages/api/` to surowy
wiersz PostgREST**, więc `npm run db:types` (słusznie wymagany przez `AGENTS.md:11` dla persystencji)
jest krokiem nośnym w publicznym kontrakcie HTTP. Migracja na pięciu tabelach po cichu przepisuje
wire i propsy przeglądarki, i nie ma warstwy, która musiałaby się na to zgodzić.

**Decyzja kolejnościowa:** fazy 1–3 planu ACL idą **przed** planem niezmiennika z Fazy 11. Tabela
`REJECTION_BY_SQLSTATE` z `02-invariant-aggregate-refactor.md:363-390` należy do
`adapters/supabase/errors.ts`, który tworzy dopiero plan ACL; odwrotna kolejność zbudowałaby ją w
`services/appointments.ts` i zaraz przeniosła.

/**
 * Test-data setup and teardown, over a direct Postgres connection.
 *
 * Why not the app's own API: there is no delete-appointment surface (the schema deliberately grants
 * DELETE on `appointments` / `customers` to nobody but `postgres`), so a spec cannot clean up
 * through the UI, and a denial test cannot create the resource it must be refused. This helper is
 * the only sanctioned back door. It must never be used to *assert* an outcome — assertions belong
 * in the browser, against what the user actually sees.
 *
 * Local stack only: the connection string lives in .env.e2e and points at 127.0.0.1.
 */
import { Client } from "pg";

function connectionString(): string {
  const value = process.env.E2E_DATABASE_URL;
  if (!value) {
    throw new Error("E2E_DATABASE_URL is not set — copy .env.e2e.example to .env.e2e (see e2e/README.md).");
  }
  return value;
}

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Workshop owned by the given fixture account, resolved by e-mail. */
export function workshopIdOf(email: string): Promise<string> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ workshop_id: string }>(
      `select p.workshop_id
         from public.profiles p
         join auth.users u on u.id = p.user_id
        where u.email = $1`,
      [email],
    );

    if (!rows.length) {
      throw new Error(`fixture account ${email} not found — run \`npm run db:reset\``);
    }

    return rows[0].workshop_id;
  });
}

export interface SeededAppointment {
  appointmentId: string;
  startsAt: string;
}

/**
 * Inserts an appointment straight into a workshop. Used when the appointment is the test's *setup*
 * rather than its subject — a row to change the status of, or a workshop-B resource the session
 * under test must be refused (which by definition it cannot create itself).
 */
export function seedAppointment(options: {
  workshopId: string;
  date: string;
  time: string;
  customerFirstName: string;
  customerPhone: string;
}): Promise<SeededAppointment> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ id: string; starts_at: string }>(
      `with picked as (
         select
           (select id from public.bays
             where workshop_id = $1 and is_active order by name limit 1) as bay_id,
           (select id from public.services
             where workshop_id = $1 order by name limit 1) as service_id,
           (select duration_min from public.services
             where workshop_id = $1 order by name limit 1) as duration_min
       ),
       customer as (
         insert into public.customers (workshop_id, first_name, phone)
         values ($1, $2, $3)
         returning id
       )
       insert into public.appointments (workshop_id, customer_id, service_id, bay_id, starts_at, ends_at)
       select $1, customer.id, picked.service_id, picked.bay_id,
              ($4 || ' ' || $5)::timestamp,
              ($4 || ' ' || $5)::timestamp + make_interval(mins => picked.duration_min)
         from picked, customer
       returning id, to_char(starts_at, 'YYYY-MM-DD HH24:MI') as starts_at`,
      [options.workshopId, options.customerFirstName, options.customerPhone, options.date, options.time],
    );

    return { appointmentId: rows[0].id, startsAt: rows[0].starts_at };
  });
}

/**
 * Removes every appointment and customer carrying this run's unique phone. Safe to call when the
 * test created nothing (a run that failed before setup) — deleting zero rows is not an error.
 */
export function deleteCustomerByPhone(phone: string): Promise<void> {
  return withClient(async (client) => {
    await client.query(
      `delete from public.appointments
        where customer_id in (select id from public.customers where phone = $1)`,
      [phone],
    );
    await client.query(`delete from public.customers where phone = $1`, [phone]);
  });
}

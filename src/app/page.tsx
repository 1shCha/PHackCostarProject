import { runAll } from "@/agents";
import SecondLifeApp from "@/components/SecondLifeApp";

// Run the agents on every request (not once at build time) so new data shows up immediately.
export const dynamic = "force-dynamic";

// Runs every agent on the server, then hands the results to the app screens.
export default async function Home() {
  const card = await runAll("travis_900");
  return <SecondLifeApp card={card} />;
}

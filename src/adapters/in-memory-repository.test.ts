/**
 * In-memory adapter — runs the shared Repository contract (DEC-020). Passing the
 * same suite the Postgres adapter passes is what proves the in-memory double is
 * contract-equivalent, so the domain tests that lean on it are trustworthy.
 */
import { InMemoryRepository } from "./in-memory-repository.js";
import { runRepositoryContract } from "./repository-contract.js";

runRepositoryContract("in-memory", async () => new InMemoryRepository());

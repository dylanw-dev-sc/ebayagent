/** Create / migrate / seed the local database: npm run db:setup */
import { getDbHandle } from "../src/server/db/client";
import { refreshDerivedData } from "../src/server/services/evaluation";

const { db, path } = getDbHandle();
const r = refreshDerivedData(db);
console.log(`Database ready at ${path} (re-evaluated ${r.evaluated} listings, priced ${r.priced}).`);

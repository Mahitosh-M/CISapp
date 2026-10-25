import { beforeAll, afterAll, describe, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
(emulator ? describe : describe.skip)(
  "Dispatch direct-access isolation",
  () => {
    let env: RulesTestEnvironment;
    beforeAll(async () => {
      if (!emulator || !/^127\.0\.0\.1:\d+$/.test(emulator))
        throw new Error("Loopback Firestore emulator required");
      const [host, port] = emulator.split(":");
      env = await initializeTestEnvironment({
        projectId: "demo-cis-dispatch",
        firestore: {
          host,
          port: Number(port),
          rules: readFileSync("firestore.rules", "utf8"),
        },
      });
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, "users/driver"), {
          uid: "driver",
          role: "Driver",
          active: true,
        });
        await setDoc(doc(db, "users/admin"), {
          uid: "admin",
          role: "Admin",
          active: true,
        });
        await setDoc(doc(db, "invoices/private"), {
          customerId: "customer",
          totalSales: 2000,
          totalCost: 1000,
          totalProfit: 1000,
        });
        await setDoc(doc(db, "customers/customer"), {
          name: "Fictional pharmacy",
          mobile: "0000000000",
        });
        await setDoc(doc(db, "dispatchCollections/private"), {
          status: "Pending",
          amount: 200000,
        });
      });
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    it("does not grant drivers raw invoice, cost, customer or payment access", async () => {
      const db = env.authenticatedContext("driver").firestore();
      await assertFails(getDoc(doc(db, "invoices/private")));
      await assertFails(getDoc(doc(db, "customers/customer")));
      await assertFails(
        setDoc(doc(db, "payments/driver-posted"), {
          customerId: "customer",
          invoiceId: "private",
          amount: 2000,
        }),
      );
    });
    it("keeps bridge operational documents server-only even for CISapp Admin clients", async () => {
      for (const uid of ["driver", "admin"]) {
        const db = env.authenticatedContext(uid).firestore();
        await assertFails(getDoc(doc(db, "dispatchCollections/private")));
        await assertFails(
          setDoc(doc(db, "dispatchCollections/private"), { status: "Posted" }),
        );
        await assertFails(
          setDoc(doc(db, "dispatchApprovals/forged"), { receiptIds: ["fake"] }),
        );
        await assertFails(
          setDoc(doc(db, "dispatchIdentities/forged"), {
            role: "DRIVER",
            active: true,
          }),
        );
      }
    });
  },
);

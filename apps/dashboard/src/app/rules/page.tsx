import AppShell from "@/components/layout/app-shell";
import { canShare } from "@/server/auth/can-share";
import {
  listMerchantRules,
  listCategoryRules,
  listMerchantOverrides,
  listCategoryOverrides,
  listAccounts,
  listCounterparties,
} from "@/server/rules/repository";
import RulesEditor from "./rules-editor";

export default async function RulesPage() {
  const showShare = await canShare();

  const [merchantRules, categoryRules, merchantOverrides, categoryOverrides, accounts, counterparties] =
    await Promise.all([
      listMerchantRules(),
      listCategoryRules(),
      listMerchantOverrides(),
      listCategoryOverrides(),
      listAccounts(),
      listCounterparties(),
    ]);

  return (
    <AppShell canShare={showShare} pageTitle="Rules">
      <RulesEditor
        merchantRules={merchantRules}
        categoryRules={categoryRules}
        merchantOverrides={merchantOverrides}
        categoryOverrides={categoryOverrides}
        accounts={accounts}
        counterparties={counterparties}
      />
    </AppShell>
  );
}

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    // قواعد صرامة المُصرِّف الجديدة في eslint-plugin-react-hooks (رُفعت مع eslint-config-next 16.4.6 — تكليف 44)
    // كانت معلقة على 29 موقعًا قائمًا — Q1 (تكليف 52) أعادت هيكلتها كلها مكافئة بلا تغيير سلوكي
    // (لقطات حالة في حلقة اللعبة · useSyncExternalStore للتخزين والوسائط · ضبط أثناء الرندر للتصفير
    // · مهلة مايكروتاسك للجلب بعد الالتزام · تهيئة كسولة للمحطة) — الآن بوابة رجوع دائمة: أي موقع جديد يفشل بأول جولة.
    "react-hooks/refs": "error",
    "react-hooks/set-state-in-effect": "error",
    "react-hooks/static-components": "error",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills",
    // سكربتات CJS متعمدة تعمل بـ node الخام داخل حزمة سطح المكتب (بلا تبعيات ولا تحويل)
    "apps/desktop/**", "mini-services/gateway/**",
    // سكربتات صيانة CJS خام في scripts (تنظيف بقايا E2E وما شابه — node خام بلا تحويل)
    "scripts/*.cjs",
    // مولّد وثيقة خارطة الطريق DOCX — CJS خام بـrequire() صريح ومسار مطلق خارج المستودع (أداة صيانة محلية)
    "scripts/generate-roadmap-docx.js",
    // مخرجات تحقق مصدر flutter_webrtc المنزّلة — ملفات مولّدة (Dart→JS) لا تُلمس ولا تُراجع
    "scripts/deps-verify/**"]
}];

export default eslintConfig;

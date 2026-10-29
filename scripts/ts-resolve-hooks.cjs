// خطاف حل الوحدات لبوابة relay-e2e (§49): استيراد «./relay-core» بلا امتداد
// من ملف TS يمر في مجمّع Next تلقائيًا لكن node الخام يرفضه — هذا الخطاف
// يكمل «.ts» للSpecifier النسبي بلا امتداد الصادر من ملف TS حصرًا.
// يُسجَّل برمجيًا من البوابة قبل الاستيرادات الديناميكية — صفر أثر خارجها.
const { registerHooks } = require("node:module")

function registerTsResolve() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL || ""
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../")
      const withoutQuery = String(specifier).split("?")[0]
      const hasExt = /\.[a-z0-9]{1,8}$/i.test(withoutQuery)
      if (isRelative && !hasExt && parent.endsWith(".ts")) {
        try {
          return nextResolve(specifier + ".ts", context)
        } catch (e) { /* يسقط للمسار الأصلي أسفل */ }
      }
      return nextResolve(specifier, context)
    },
  })
}

module.exports = { registerTsResolve }

"use client"

import { useNexus } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Moon, Sun, Languages, ShieldCheck, Wifi, Cpu, Info, Radio } from "lucide-react"

export function SettingsView() {
  const { theme, toggleTheme, devices } = useNexus()
  const connected = devices.filter((d) => d.state === "connected").length

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">الإعدادات</h1>
        <p className="text-sm text-muted-foreground mt-0.5">خصّص تجربة NexusLink على هذا الجهاز</p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary grid place-items-center">
                {theme === "dark" ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
              </div>
              <div>
                <Label className="text-sm font-semibold">المظهر</Label>
                <p className="text-xs text-muted-foreground">داكن أو فاتح — يُحفظ تلقائياً</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{theme === "dark" ? "داكن" : "فاتح"}</span>
              <Switch checked={theme === "dark"} onCheckedChange={toggleTheme} />
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary grid place-items-center">
                <Languages className="w-4.5 h-4.5" />
              </div>
              <div>
                <Label className="text-sm font-semibold">اللغة والاتجاه</Label>
                <p className="text-xs text-muted-foreground">العربية — دعم RTL كامل</p>
              </div>
            </div>
            <Badge variant="outline">ar · RTL</Badge>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary grid place-items-center">
                <Wifi className="w-4.5 h-4.5" />
              </div>
              <div>
                <Label className="text-sm font-semibold">الاكتشاف التلقائي (mDNS)</Label>
                <p className="text-xs text-muted-foreground">ابحث عن الأجهزة على الشبكة المحلية</p>
              </div>
            </div>
            <Switch defaultChecked />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary grid place-items-center">
                <Radio className="w-4.5 h-4.5" />
              </div>
              <div>
                <Label className="text-sm font-semibold">نبض Nexus Protocol</Label>
                <p className="text-xs text-muted-foreground">فحص الاتصال كل 5 ثوانٍ (JSON/TCP)</p>
              </div>
            </div>
            <Switch defaultChecked />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary grid place-items-center">
                <ShieldCheck className="w-4.5 h-4.5" />
              </div>
              <div>
                <Label className="text-sm font-semibold">تشفير القناة</Label>
                <p className="text-xs text-muted-foreground">TLS + تشفير طرف-لطرف (libsodium)</p>
              </div>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Info className="w-4 h-4 text-primary" /> عن التطبيق
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" /> الإصدار: NexusLink 2.4.1</div>
            <div className="flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5" /> أجهزة متصلة: {connected}</div>
            <div>البروتوكول: Nexus/1.2 (JSON/TCP + Heartbeat)</div>
            <div>النقل: Chunked 256KB · Resume · Parallel</div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-5">
            يعمل NexusLink محلياً بالكامل على شبكتك المنزلية — لا حاجة لأي خدمة سحابية، ولا تُرسل بياناتك خارج أجهزتك أبداً.
          </p>
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={toggleTheme}>
        {theme === "dark" ? <Sun className="w-4 h-4 me-2" /> : <Moon className="w-4 h-4 me-2" />}
        تبديل سريع للمظهر
      </Button>
    </div>
  )
}

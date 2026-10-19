#!/usr/bin/env python3
"""Render NexusLink roadmap visual (RTL Arabic, phased Layout C) to PNG."""
import asyncio
import os
from playwright.async_api import async_playwright

HTML = '/home/z/my-project/scripts/roadmap-visual.html'
OUT = '/home/z/my-project/download/NexusLink-Roadmap-Visual.png'


async def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={'width': 1340, 'height': 900},
            device_scale_factor=2,
        )
        await page.goto(f'file://{HTML}', wait_until='networkidle')
        await page.wait_for_timeout(600)

        el = page.locator('#root')
        bbox = await el.bounding_box()
        if bbox:
            fit_w = max(1340, int(bbox['width'] + 100))
            fit_h = int(bbox['height'] + 100)
            await page.set_viewport_size({'width': fit_w, 'height': fit_h})
            await page.wait_for_timeout(300)
        await el.screenshot(path=OUT)
        await browser.close()
        print(f'OK {OUT} ({os.path.getsize(OUT)/1024:.0f}KB)')


asyncio.run(main())

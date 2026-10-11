"""Browser-only UI smoke: native Zotero and network calls are mocked."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root=Path(__file__).resolve().parent.parent
content=(root/'tests/ui-smoke.html').read_text()
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1400,'height':900})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(content,wait_until='load')
    expect(page.locator('#selectedCount')).to_contain_text('1 篇')
    page.locator('#settingsBtn').click()
    page.locator('#proxyMode').select_option('custom')
    expect(page.locator('#proxyHostLabel')).to_be_visible()
    page.locator('#proxyType').select_option('socks5')
    page.locator('#proxyHost').fill('127.0.0.1')
    page.locator('#proxyPort').fill('9876')
    page.locator('#saveSettings').click()
    page.locator('#cloneAPIProfile').click()
    page.locator('#proxyMode').select_option('direct')
    page.locator('#saveSettings').click()
    assert page.locator('#apiProfileSelect option').count()==2
    ids=page.locator('#apiProfileSelect option').evaluate_all('(items)=>items.map(x=>x.value)')
    page.locator('#apiProfileSelect').select_option(ids[0])
    expect(page.locator('#proxyMode')).to_have_value('custom')
    expect(page.locator('#proxyPort')).to_have_value('9876')
    page.locator('#proxyMode').select_option('inherit')
    page.locator('#apiKey').fill('smoke-key')
    page.locator('#saveSettings').click()
    page.locator('#dataConsent').check()
    page.locator('#question').fill('道路拓扑提取方法有哪些已证实的跨区域局限与潜在研究空白？')
    page.locator('#settingsBtn').click()
    page.locator('#runBtn').click()
    expect(page.locator('#resultsPanel')).to_be_visible(timeout=12000)
    expect(page.locator('#gapView')).to_contain_text('研究空白')
    # A citation button in the Gap summary opens the matching paper even when
    # evidence rows have not yet been materialized.
    page.locator('#gapView .gap-cites button').first.click()
    expect(page.locator('#evidenceView details.evidence-paper[open] .evidence-line').first).to_be_visible()
    page.locator('#evidenceView details summary').click()
    expect(page.locator('#evidenceView .evidence-line')).to_have_count(0)
    page.locator('.tab[data-tab="gaps"]').click()
    # No evidence quote DOM is created until its paper is expanded.
    expect(page.locator('#evidenceView details.evidence-paper')).to_have_count(1)
    expect(page.locator('#evidenceView .evidence-line')).to_have_count(0)
    page.locator('.tab[data-tab="evidence"]').click()
    page.locator('#evidenceView details summary').click()
    expect(page.locator('#evidenceView .evidence-line').first).to_be_visible()
    page.locator('#evidenceView details summary').click()
    expect(page.locator('#evidenceView .evidence-line')).to_have_count(0)
    page.locator('.tab[data-tab="gaps"]').click()
    page.locator('#generateDraftBtn').click()
    expect(page.locator('#draftOutput')).to_have_value(__import__('re').compile('Research Gaps'),timeout=12000)
    page.locator('#locatePagesBtn').click()
    expect(page.locator('#pageStatus')).to_contain_text('真实匹配',timeout=12000)
    # PDF page matching is expected to be unavailable in this browser fake.
    expect(page.locator('#pageStatus')).to_contain_text('0 处')
    assert not errors, errors
    print('Browser UI smoke: API proxy switches, Gap/draft, lazy evidence expand/collapse, page status passed')
    browser.close()

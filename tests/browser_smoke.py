"""Browser-only UI smoke: exercises dropdowns, Gap review, matrix editing and evidence workflows."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parent.parent
content = (root/'tests/ui-smoke.html').read_text()

def pick(page, element_id, value):
    select=page.locator('#'+element_id)
    label=select.locator('option').evaluate_all('(opts, value) => (opts.find(o=>o.value===value)||{}).textContent',value)
    if not label:
        raise AssertionError(f'Missing value {value} in {element_id}')
    select.locator('xpath=..').locator('.rs-picker-button').click()
    popup=page.locator('.rs-dropdown-portal')
    expect(popup).to_be_visible()
    # A nontransparent, high-z-index popup avoids mingling with original form options.
    rendered=popup.evaluate('(el)=>({background:getComputedStyle(el).backgroundColor,z:Number(getComputedStyle(el).zIndex)})')
    assert rendered['z']>10000, rendered
    assert rendered['background'] not in ['rgba(0, 0, 0, 0)','transparent'],rendered
    popup.get_by_role('option',name=label.strip(),exact=True).click()
    expect(select).to_have_value(value)
    expect(popup).to_be_hidden()

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1400,'height':900})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(content,wait_until='load')
    expect(page.locator('#selectedCount')).to_contain_text('1 篇')
    page.locator('#settingsBtn').click()
    expect(page.locator('#chatgptAuthBox')).to_be_visible()
    expect(page.locator('#apiKeyLabel')).to_be_hidden()
    expect(page.locator('.top-actions>.rs-picker')).to_be_visible()
    assert 'chatgpt'==page.locator('#apiProvider').input_value()

    # Preserve the no-key ChatGPT default; add an independent legacy API profile.
    page.locator('#addAPIProfile').click()
    pick(page,'apiProvider','openai')
    expect(page.locator('#apiKeyLabel')).to_be_visible()
    pick(page,'proxyMode','custom')
    expect(page.locator('#proxyHostLabel')).to_be_visible()
    pick(page,'proxyType','socks5')
    page.locator('#proxyHost').fill('127.0.0.1')
    page.locator('#proxyPort').fill('9876')
    page.locator('#saveSettings').click()
    page.locator('#cloneAPIProfile').click()
    pick(page,'proxyMode','direct')
    page.locator('#saveSettings').click()
    assert page.locator('#apiProfileSelect option').count()==3
    ids=page.locator('#apiProfileSelect option').evaluate_all('(items)=>items.map(x=>x.value)')
    pick(page,'apiProfileSelect',ids[1])
    expect(page.locator('#proxyMode')).to_have_value('custom')
    expect(page.locator('#proxyPort')).to_have_value('9876')
    pick(page,'proxyMode','inherit')
    page.locator('#apiKey').fill('smoke-key')
    page.locator('#saveSettings').click()
    page.locator('#dataConsent').check()
    page.locator('#question').fill('道路拓扑提取方法有哪些已证实的跨区域局限与潜在研究空白？')
    page.locator('#settingsBtn').click()
    page.locator('#runBtn').click()
    expect(page.locator('#resultsPanel')).to_be_visible(timeout=12000)
    expect(page.locator('#gapView')).to_contain_text('研究空白')
    # A researcher can revise a Gap's wording; the edit returns it to pending
    # review before it may enter a subsequent draft.
    page.locator('#gapView .gap-review-actions .btn', has_text='修改论断').click()
    page.locator('#gapView .gap-edit-panel textarea').fill('人工修订：跨区域拓扑泛化仍缺少独立验证')
    page.locator('#gapView .gap-edit-actions .btn', has_text='保存修改').click()
    expect(page.locator('#gapView')).to_contain_text('人工修订：跨区域拓扑泛化仍缺少独立验证')
    page.locator('#gapView .gap-review-actions .btn', has_text='接受并纳入初稿').click()
    expect(page.locator('#gapView')).to_contain_text('已接受纳入初稿')
    # The comparison matrix supports editing, incremental refresh, and export.
    page.locator('.tab[data-tab="matrix"]').click()
    expect(page.locator('#matrixTableWrap .matrix-table tbody tr')).to_have_count(1)
    dataset_cell=page.locator('#matrixTableWrap textarea[data-matrix-key="dataset"]').first
    dataset_cell.fill('Smoke dataset')
    page.locator('#refreshMatrixBtn').click()
    expect(dataset_cell).to_have_value('Smoke dataset')
    page.locator('#copyMatrixTSVBtn').click()
    assert 'Smoke dataset' in page.evaluate('window.copied')
    page.locator('.tab[data-tab="gaps"]').click()
    page.locator('#gapView .gap-cites button').first.click()
    expect(page.locator('#evidenceView details.evidence-paper[open] .evidence-line').first).to_be_visible()
    page.locator('#evidenceView details summary').click()
    expect(page.locator('#evidenceView .evidence-line')).to_have_count(0)
    page.locator('.tab[data-tab="gaps"]').click()
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
    expect(page.locator('#pageStatus')).to_contain_text('0 处')
    assert not errors, errors
    page.screenshot(path=str(root/'tests/dropdown-example.png'))
    print('Browser UI: opaque dropdown portal, API switching, Gap/draft and lazy evidence passed')
    browser.close()

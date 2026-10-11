pref("extensions.zoteroReviewStudio.endpoint", "https://api.openai.com/v1/chat/completions");
pref("extensions.zoteroReviewStudio.model", "gpt-4.1-mini");
pref("extensions.zoteroReviewStudio.maxCharsPerPaper", "180000");
pref("extensions.zoteroReviewStudio.chunkChars", "11000");
pref("extensions.zoteroReviewStudio.maxTemplateChars", "280000");
pref("extensions.zoteroReviewStudio.analysisLanguage", "zh-CN");
pref("extensions.zoteroReviewStudio.customTemplates", "[]");
pref("extensions.zoteroReviewStudio.apiKey", "");

// v0.3.0: multi-profile metadata and active selection; per-profile keys are
// deliberately NOT included in apiProfiles JSON. Keys are memory-only unless
// explicitly remembered in profileSecret.<id> preferences.
pref("extensions.zoteroReviewStudio.apiProfiles", "");
pref("extensions.zoteroReviewStudio.activeAPIProfile", "");

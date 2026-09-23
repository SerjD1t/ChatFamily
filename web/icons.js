// Fixed outline icons shared by message actions and auxiliary windows.
const paths={
 pin:'<path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6M12 15v6"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 zoomIn:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6M10 7v6"/>',
 zoomOut:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6"/>',
 reaction:'<path d="M21 12a9 9 0 1 1-9-9M8 14q4 5 8 0M8 9h.01M14 9h.01M19 2v6M16 5h6"/>',
 reply:'<path d="m9 5-6 6 6 6M3 11h12a6 6 0 0 1 6 6"/>',
 more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
};
export function iconMarkup(name){return `<svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]||''}</svg>`;}

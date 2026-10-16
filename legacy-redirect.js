(() => { const dest=document.body.dataset.redirect; if(dest && /^(\.\.\/)?[a-z0-9-]+\.html$/.test(dest)) location.replace(dest+location.search+location.hash); })();

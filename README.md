# CEVECA · Sito della clinica

Sito italiano per il Centro Veterinario Catanzaro. Su GitHub Pages il carosello mostra fino a sei post con foto dalla pagina Facebook della clinica, ordinati dal più recente. Alla prima pubblicazione mostra le sei foto già incluse nel sito.

## GitHub Pages e Facebook

1. Nelle impostazioni del repository, apri **Settings → Pages → Build and deployment** e scegli **GitHub Actions**. Il workflow **CEVECA Pages** pubblica il sito a ogni push su `main`.
2. Ottieni da Meta un token di accesso della **pagina Facebook del Centro Veterinario Catanzaro**, con il permesso `pages_read_engagement`. Il token deve appartenere alla pagina della clinica perché il sincronizzatore legge `/me/published_posts`. Per un processo programmato usa un token di lunga durata. [Guida Meta ai token di pagina](https://developers.facebook.com/docs/pages-api/getting-started/page-access-tokens/)
3. Apri **Settings → Secrets and variables → Actions → New repository secret** e salva il token come `FACEBOOK_PAGE_ACCESS_TOKEN`. Puoi anche impostare la variabile facoltativa `FACEBOOK_GRAPH_VERSION` per scegliere la versione della Graph API, che di default è `v27.0`.
4. Per verificare il collegamento, apri **Actions → CEVECA Pages → Run workflow** su `main` e lascia selezionato l’aggiornamento delle foto. A fine esecuzione apri il link del deployment e controlla il primo post.

L’aggiornamento è programmato ogni giorno alle **05:17 UTC**. GitHub Actions scarica le immagini, salva i post aggiornati in `feed/` su `main` e pubblica il sito. Se Meta rifiuta il token o una foto non si scarica, il workflow segnala l’errore e resta online l’ultima versione. Dopo aver sostituito un token scaduto, riesegui il workflow. Per pubblicare le modifiche al sito usando le foto già salvate, avvialo con l’aggiornamento delle foto deselezionato.

Per visualizzare lo stesso sito in locale, esegui `npm run build:pages` e poi `python3 -m http.server 4173 --directory dist/pages`. Apri `http://localhost:4173`.

## Aggiornamenti da ChatGPT nella versione Sites

La persona che gestisce il sito usa la conversazione **CEVECA · Aggiornamenti del sito**. Scrive «Aggiorna il sito con gli ultimi post Instagram», verifica i titoli e i link, poi risponde «Pubblica questo aggiornamento». La pubblicazione del carosello aggiorna i contenuti del sito senza un nuovo deploy. Per controllare l’ultimo aggiornamento, scrive «Quali post sono online?».

Il testo da inserire nelle istruzioni della conversazione o del progetto ChatGPT è in [Redazione-ChatGPT.md](Redazione-ChatGPT.md). La conversazione va creata nell’account ChatGPT della persona che gestirà il sito, dopo aver collegato lo strumento CEVECA.

## Configurazione iniziale per ChatGPT Sites

1. Pubblica questo repository come un nuovo progetto ChatGPT Sites nell’area di lavoro della clinica. Salva il nuovo `project_id` nella configurazione di hosting con il workflow di Sites. La configurazione dichiara un Worker, la capacità MCP e il binding R2 `BUCKET`. Il server si affida a Sites per autenticare le richieste a `/mcp` e ottenere l’identità verificata del chiamante. Distribuisci il Worker dietro questa integrazione.
2. Collega l’account Instagram professionale di CEVECA a un’app Meta tramite Instagram Login. Usa un token con il permesso di lettura `instagram_business_basic`. Configura nell’ambiente server di Sites `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` e `INSTAGRAM_API_VERSION`. Usa l’ID restituito da Meta e una versione Graph API abilitata per l’app. Conserva il token nei segreti di Sites e rinnovalo alla scadenza. Il token non va incollato nella chat.
3. Imposta `CEVECA_EDITOR_EMAILS` con gli indirizzi verificati degli account ChatGPT autorizzati, separati da virgola. Esegui la prima pubblicazione e collega nell’account della persona incaricata il connettore generato da Sites. Verifica che quell’account possa chiamare gli strumenti del sito e che un account non autorizzato non possa farlo.
4. Dalla chat della redazione, esegui un’anteprima, conferma il primo aggiornamento e controlla che la pagina pubblicata mostri i contenuti restituiti. Dopo questo collaudo, la persona incaricata ripete lo stesso passaggio quando vuole aggiornare il sito.

Il progetto contiene una sincronizzazione su richiesta. La persona incaricata può usarla periodicamente dalla stessa chat. In caso di errore Meta, perdita di autorizzazione o foto non disponibile, resta visibile l’ultimo carosello pubblicato. Al primo avvio resta visibile la selezione Facebook. In caso di anteprima superata da un altro aggiornamento, basta chiedere una nuova anteprima.

Riferimenti tecnici. [Meta Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) · [ChatGPT Sites](https://help.openai.com/it-it/articles/20001339-creating-and-using-chatgpt-sites)

## Sviluppo

Usa Node.js 22 o successivo. `npm test` compila il Worker e verifica la sincronizzazione con risposte Meta e R2 simulate. `npm run preview` serve il sito e il carosello Facebook locale. Puoi anche aprire `public/index.html` direttamente nel browser.

- `public/` contiene la pagina, gli stili, il carosello e le immagini originali usate come ripiego.
- `worker/index.js` legge Meta, valida i risultati, salva le fotografie e pubblica il feed in R2.
- `scripts/build.mjs` incorpora i file pubblici nel Worker e genera `dist/server/index.js` e `dist/.openai/hosting.json` per Sites.

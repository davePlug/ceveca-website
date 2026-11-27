# CEVECA · Sito della clinica

Sito italiano per il Centro Veterinario Catanzaro. Servizi, contatti e indicazioni sono nel sito. Il carosello mostra fino a sei post Instagram, dal più recente al meno recente, con un link a ogni pubblicazione. Le foto dei post Facebook già selezionati restano disponibili finché non viene importato un feed Instagram.

## Aggiornamenti da ChatGPT

La persona che gestisce il sito usa la conversazione **CEVECA · Aggiornamenti del sito**. Scrive «Aggiorna il sito con gli ultimi post Instagram», verifica i titoli e i link, poi risponde «Pubblica questo aggiornamento». La pubblicazione del carosello aggiorna i contenuti del sito senza un nuovo deploy. Per controllare l’ultimo aggiornamento, scrive «Quali post sono online?».

Il testo da inserire nelle istruzioni della conversazione o del progetto ChatGPT è in [Redazione-ChatGPT.md](Redazione-ChatGPT.md). La conversazione va creata nell’account ChatGPT della persona che gestirà il sito, dopo aver collegato lo strumento CEVECA.

## Configurazione iniziale per chi pubblica il sito

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

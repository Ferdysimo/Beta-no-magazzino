import {
  BadgeEuro,
  ClipboardList,
  FileClock,
  FileUp,
  Tags,
  Wine,
} from 'lucide-react';

import ToolsHubPage from './ToolsHubPage';


export const FEDERICO_HUBS = {
  controlli: {
    title: 'Controlli',
    description: 'Caricamenti, movimenti di cassa e storico chiusure',
    icon: ClipboardList,
    items: [
      {
        testId: 'hub-federico-caricamenti',
        title: 'Controllo caricamenti',
        description: 'Tentativi di invio delle foto di chiusura',
        path: '/controllo-caricamenti',
        icon: FileUp,
      },
      {
        testId: 'hub-federico-movimenti',
        title: 'Check singoli movimenti',
        description: 'Audit delle modifiche alla Cassa e alle bevande',
        path: '/audit-cassa',
        icon: ClipboardList,
      },
      {
        testId: 'hub-federico-chiusure',
        title: 'Storico chiusure',
        description: 'Vista giornaliera completa per locale',
        path: '/chiusure-excel',
        icon: FileClock,
      },
    ],
  },
  prezzi: {
    title: 'Impostazioni prezzi',
    description: 'Listini usati nei Report dei locali',
    icon: BadgeEuro,
    items: [
      {
        testId: 'hub-federico-prezzi-bevande',
        title: 'Prezzi delle bevande',
        description: 'Listino bevande configurabile per locale',
        path: '/dizionario-bevande',
        icon: Wine,
      },
      {
        testId: 'hub-federico-prezzi-paste',
        title: 'Nomi e prezzi delle paste',
        description: 'Sigle e prezzi per il riconoscimento automatico',
        path: '/dizionario-paste',
        icon: Tags,
      },
    ],
  },
};

const FedericoHubPage = ({ section }) => (
  <ToolsHubPage hub={FEDERICO_HUBS[section]} />
);

export default FedericoHubPage;

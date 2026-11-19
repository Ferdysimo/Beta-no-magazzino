import {
  Camera,
  ClipboardCheck,
  FileClock,
  FileUp,
  FlaskConical,
  Settings2,
  ShieldCheck,
  Store,
  Trash2,
  Warehouse,
} from 'lucide-react';

import ToolsHubPage from './ToolsHubPage';


export const SIMONE_HUBS = {
  magazzino: {
    title: 'Controlli magazzino',
    description: 'Giacenze, richieste merce e ricezioni dei locali',
    icon: Warehouse,
    items: [
      {
        testId: 'hub-magazzino-fotografie',
        title: 'Magazzino alle 06:00',
        description: 'Fotografie giornaliere delle giacenze',
        path: '/simone/fotografie-magazzino',
        icon: Camera,
      },
      {
        testId: 'hub-magazzino-richieste',
        title: 'Audit richieste merce',
        description: 'Richieste cancellate e modifiche ai DDT',
        path: '/simone/richieste-cancellate',
        icon: FileClock,
      },
      {
        testId: 'hub-magazzino-trasporti',
        title: 'Controlli trasporti',
        description: 'Ricezioni controllate dai locali',
        path: '/admin/controlli-trasporti',
        icon: ClipboardCheck,
      },
    ],
  },
  audit: {
    title: 'Audit sistema',
    description: 'Controlli tecnici e registri delle operazioni anomale',
    icon: ShieldCheck,
    items: [
      {
        testId: 'hub-audit-caricamenti',
        title: 'Controllo caricamenti',
        description: 'Tentativi di invio delle foto di chiusura',
        path: '/controllo-caricamenti',
        icon: FileUp,
      },
      {
        testId: 'hub-audit-cestino',
        title: 'Cestino Generale — Audit',
        description: 'Ordini nascosti dal Tablet Generale',
        path: '/cestino-generale',
        icon: Trash2,
      },
    ],
  },
  impostazioni: {
    title: 'Impostazioni amministrative',
    description: 'Configurazione della rete locali e strumenti sperimentali',
    icon: Settings2,
    items: [
      {
        testId: 'hub-impostazioni-locali',
        title: 'Crea nuovi locali',
        description: 'Configurazione iniziale delle nuove aperture',
        path: '/simone/crea-locali',
        icon: Store,
      },
      {
        testId: 'hub-impostazioni-laboratorio',
        title: 'Laboratorio',
        description: 'Esperimenti isolati e strumenti in prova',
        path: '/laboratorio',
        icon: FlaskConical,
      },
    ],
  },
};

const SimoneHubPage = ({ section }) => {
  return <ToolsHubPage hub={SIMONE_HUBS[section]} />;
};

export default SimoneHubPage;

// decisionTree.js

// Nodo base del árbol
const decisionTree = {
  id: 'root',
  text: '',
  children: [
    {
      id: 'tramites',
      text: 'Trámites y Servicios',
      children: [
        {
          id: 'licencias_conducir',
          text: 'Agendar Licencia de Conducir',
          link: 'https://servicios.mpuentealto.cl/?utm_source=chatgpt.com#licencia-conducir'
        },
        {
          id: 'pago_municipales',
          text: 'Pago de Servicios Municipales',
          link: 'https://www.mpuentealto.cl/42438-2/?utm_source=chatgpt.com'
        },
        {
          id: 'trabajos_via_publica',
          text: 'Solicitud de Trabajos en Vía Pública',
          link: 'https://servicios.mpuentealto.cl/?utm_source=chatgpt.com#trabajos-via-publica'
        },
        {
          id: 'dom',
          text: 'Trámites Dirección de Obras Municipales',
          link: 'https://servicios.mpuentealto.cl/?utm_source=chatgpt.com#direccion-obras'
        },
        {
          id: 'organizaciones_comunitarias',
          text: 'Constitución de Organizaciones Comunitarias',
          link: 'https://www.mpuentealto.cl/organizaciones-comunitarias-oocc/?utm_source=chatgpt.com'
        },
        {
          id: 'encuestas_participacion',
          text: 'Encuestas y Participación Ciudadana',
          link: 'https://servicios.mpuentealto.cl/?utm_source=chatgpt.com#encuestas'
        }
      ]
    },
    {
      id: 'institucional',
      text: 'Información Institucional',
      children: [
        {
          id: 'estructura_municipal',
          text: 'Estructura Municipal',
          link: 'https://www.mpuentealto.cl/estructura/?utm_source=chatgpt.com'
        },
        {
          id: 'organigrama',
          text: 'Organigrama y Funciones',
          link: 'https://transparencia.mpuentealto.cl/doctos/1747224687.pdf?utm_source=chatgpt.com'
        },
        {
          id: 'directorio',
          text: 'Directorio Telefónico',
          link: 'https://www.mpuentealto.cl/directorio-telefonico/?utm_source=chatgpt.com'
        }
      ]
    },
    {
      id: 'atencion',
      text: 'Modalidades de Atención',
      children: [
        {
          id: 'horarios_atencion',
          text: 'Horarios y Modalidades de Atención',
          link: 'https://www.mpuentealto.cl/modalidad-atencion/?utm_source=chatgpt.com'
        },
        {
          id: 'atencion_nocturna',
          text: 'Atención Nocturna',
          link: 'https://www.mpuentealto.cl/atencion-nocturna/?utm_source=chatgpt.com'
        }
      ]
    },
    {
      id: 'transparencia',
      text: 'Transparencia y Datos Abiertos',
      children: [
        {
          id: 'portal_transparencia',
          text: 'Portal de Transparencia',
          link: 'https://datos.mpuentealto.cl/?utm_source=chatgpt.com'
        },
        {
          id: 'datos_abiertos',
          text: 'Datos Abiertos',
          link: 'https://datos.mpuentealto.cl/?utm_source=chatgpt.com'
        }
      ]
    },
    {
      id: 'comunitario',
      text: 'Servicios Comunitarios y Culturales',
      children: [
        {
          id: 'bibliotecas',
          text: 'Centros Bibliotecarios (Bibliobuses, Biblioniños)',
          link: 'https://www.mpuentealto.cl/bibliotecas/?utm_source=chatgpt.com'
        },
        {
          id: 'educacion_salud',
          text: 'Listado de Establecimientos Educacionales y de Salud',
          link: 'https://www.mpuentealto.cl/educacion-salud/?utm_source=chatgpt.com'
        },
        {
          id: 'actividades_culturales',
          text: 'Actividades Culturales y Deportivas',
          link: 'https://www.mpuentealto.cl/actividades-culturales-deportivas/?utm_source=chatgpt.com'
        }
      ]
    },
    {
      id: 'ayuda_general',
      text: 'Otra Consulta / Ayuda General',
      children: [
        {
          id: 'contacto',
          text: 'Información de Contacto',
          link: 'https://www.mpuentealto.cl/contacto/?utm_source=chatgpt.com'
        },
        {
          id: 'horarios',
          text: 'Horarios de Atención Generales',
          link: 'https://www.mpuentealto.cl/horarios/?utm_source=chatgpt.com'
        }
      ]
    }
  ]
};

/**
 * Función para obtener las opciones hijas de un nodo dado
 * @param {string} nodeId - ID del nodo del cual queremos las opciones
 * @param {Object} tree - El árbol completo (por defecto, decisionTree)
 * @returns {Array} - Array con los nodos hijos (o vacío si no tiene)
 */
function getChildren(nodeId, tree = decisionTree) {
  if (tree.id === nodeId) {
    return tree.children || [];
  }
  if (tree.children && tree.children.length > 0) {
    for (let child of tree.children) {
      const result = getChildren(nodeId, child);
      if (result) {
        return result;
      }
    }
  }
  return [];
}

/**
 * Función para buscar un nodo por su ID
 * @param {string} nodeId - ID del nodo a buscar
 * @param {Object} tree - El árbol completo (por defecto, decisionTree)
 * @returns {Object|null} - El nodo encontrado o null si no existe
 */
function findNode(nodeId, tree = decisionTree) {
  if (tree.id === nodeId) {
    return tree;
  }
  if (tree.children && tree.children.length > 0) {
    for (let child of tree.children) {
      const result = findNode(nodeId, child);
      if (result) {
        return result;
      }
    }
  }
  return null;
}

export { decisionTree, getChildren, findNode };

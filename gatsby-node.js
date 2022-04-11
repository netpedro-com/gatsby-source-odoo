const util = require('./util')

/**
 * @param {object} fields
 * @returns {string[]}
 */
const getOdooFields = (fields) => [...new Set(['id', 'write_date'].concat(Object.keys(fields)))]

/**
 * @param {object[]} allModels
 * @param {object} fieldMetadata
 * @returns {string|*}
 */
const getGatsbyModelName = (allModels, fieldMetadata) => allModels.find(innerModel => innerModel.odooModelName === fieldMetadata.relation).gatsbyModelName

/**
 * @param {number|string|array} value
 * @param {string} type
 * @returns {string|null|*}
 */
const normalizeOdooValue = (value, type) => {

  switch (type) {
    case 'char':
    case 'html':
    case 'text':
    case 'datetime':
      return typeof value === 'string' ? value : null
    case 'integer':
      return typeof value === 'number' ? value : null
    case 'many2many':
      return value
    case 'many2one':
      return Array.isArray(value) ? value : null
    default:
      throw Error("Missing Odoo type to normalize: " + type)
  }
}

/**
 * @param {Date} date
 * @returns {string}
 */
const formatDateToOdoo = (date) => date.toISOString().replace('T', ' ').substring(0, 19)

/**
 * @param reporter
 * @returns {Promise<void>}
 */
exports.onPreInit = async ({reporter}) => {
  reporter.info("Loading gatsby-source-odoo")
}

/**
 * @param cache
 * @param url
 * @param {object[]} connections
 * @param {string} connections.url
 * @param {string} connections.database
 * @param {string} connections.username
 * @param {string} connections.password
 * @param {object[]} connections.models
 * @param {object} connections.garbageModel
 * @returns {Promise<void>}
 */
exports.onPreBootstrap = async ({cache}, {connections}) => {

  const fieldsMetadataByModelConnections = []

  for (const [connectionId, {url, database, username, password, models, garbageModel}] of connections.entries()) {

    await util.odooData.init(url, database, username, password)
    const client = util.odooData.client

    util.odooData.clientConnections[connectionId] = client
    util.odooData.languagesConnections[connectionId] = util.odooData.languages

    const fieldsMetadataByModel = {}
    fieldsMetadataByModelConnections[connectionId] = fieldsMetadataByModel

    for (const model of models.concat(garbageModel ? [garbageModel] : [])) {
      fieldsMetadataByModel[model.odooModelName] = await client.call(
        model.odooModelName,
        'fields_get',
        [getOdooFields(model.odooFields)],
        {attributes: []},
      )
    }
  }
  // Used cache because global variables doesn't work.
  await cache.set('fieldsMetadataByModelConnections', fieldsMetadataByModelConnections)
}

/**
 * @param createNode
 * @param touchNode
 * @param deleteNode
 * @param cache
 * @param createContentDigest
 * @param createNodeId
 * @param getNodesByType
 * @param getNode
 * @param reporter
 * @param {object[]} connections
 * @param {string} connections.url
 * @param {string} connections.database
 * @param {string} connections.username
 * @param {string} connections.password
 * @param {object[]} connections.models
 * @param {object} connections.garbageModel
 * @param {boolean} forceIdsOnly
 * @param {Object.<string, object>[]} forceIdsByModelConnections
 * @returns {Promise<{relatedIdsByModelConnections: Object.<string, object>[]}>}
 */
const sourceNodes = async ({
                             actions: {createNode, touchNode, deleteNode},
                             cache,
                             createContentDigest,
                             createNodeId,
                             getNodesByType,
                             getNode,
                             reporter,
                           },
                           {connections},
                           {forceIdsOnly = false, forceIdsByModelConnections = []} = {}) => {
  const relatedIdsByModelConnections = []
  const fieldsMetadataByModelConnections = await cache.get('fieldsMetadataByModelConnections')

  for (const [connectionId, {models, garbageModel}] of connections.entries()) {

    const relatedIdsByModel = {}
    relatedIdsByModelConnections[connectionId] = relatedIdsByModel

    const client = util.odooData.clientConnections[connectionId]
    const allModels = models.concat(garbageModel ? [garbageModel] : [])

    for (const model of allModels) {

      const forceIds = forceIdsByModelConnections[connectionId]?.[model.odooModelName] || []
      const hasForceIds = Boolean(forceIds.length)

      if (forceIdsOnly && !hasForceIds) {
        continue
      }
      let hasNodes = null
      //
      // Write Date
      //
      const maxWriteDate = new Date(0)
      const idsWithMaxWriteDate = []

      getNodesByType(model.gatsbyModelName).forEach(node => {
        touchNode(node)  // Avoids garbage collection
        hasNodes = true
        //
        // Write Date
        //
        const writeDate = new Date(node.write_date)
        if (writeDate > maxWriteDate) {
          maxWriteDate.setTime(writeDate.getTime())
          idsWithMaxWriteDate.length = 0
          idsWithMaxWriteDate.push(node.id_odoo)
        } else if (writeDate.getTime() === maxWriteDate.getTime()) {
          idsWithMaxWriteDate.push(node.id_odoo)
        }
      })
      const maxWriteDatePlusSecond = new Date(maxWriteDate.getTime() + 1000)

      let recordIds = []
      /** @type {{id: number, model_id: number, model_name: string, write_date: string}[]} */
      let records = []
      let limit = 50
      let offset = 0

      do {
        recordIds = await client.call(
          model.odooModelName,
          'search',
          [model.odooDomain.concat(hasForceIds ? [['id', 'in', forceIds]] : [
            '|',
            '&',
            ['id', 'not in', idsWithMaxWriteDate],
            '&',
            ['write_date', '>=', formatDateToOdoo(maxWriteDate)],
            ['write_date', '<', formatDateToOdoo(maxWriteDatePlusSecond)],
            ['write_date', '>=', formatDateToOdoo(maxWriteDatePlusSecond)],
          ])],
          {limit, offset, order: 'write_date ASC', context: {active_test: false}},
        )
        for (const lang of util.odooData.languagesConnections[connectionId]) {

          reporter.info(`Fetching: ${model.odooModelName} ${lang}`)

          records = await client.call(
            model.odooModelName,
            'search_read',
            [[['id', 'in', recordIds]], getOdooFields(model.odooFields)],
            {context: {active_test: false, lang: lang}},
          )
          records.forEach(record => {

            /** @type {{relation: string}} */
            const fieldsMetadata = fieldsMetadataByModelConnections[connectionId][model.odooModelName]
            for (const [field, attributes] of Object.entries(model.odooFields)) {
              record[field] = normalizeOdooValue(record[field], fieldsMetadata[field].type)
              //
              // Ensure Default Values
              //
              if (!record[field] && 'default' in attributes) {
                record[field] = attributes.default
              }
              //
              // Change Value
              //
              if ('change' in attributes) {
                record[field] = attributes.change(record[field])
              }
              //
              // References
              //
              switch (fieldsMetadata[field].type) {
                case 'many2many':
                  if (hasNodes) {
                    relatedIdsByModel[fieldsMetadata[field].relation] = (relatedIdsByModel[fieldsMetadata[field].relation] || [])
                      .concat(record[field])
                  }
                  record[field + '___NODE'] = record[field]
                    .map(id => createNodeId(`${getGatsbyModelName(allModels, fieldsMetadata[field])}-${id}-${lang}`))
                  delete record[field]
                  break
                case 'many2one':
                  if (hasNodes) {
                    relatedIdsByModel[fieldsMetadata[field].relation] = (relatedIdsByModel[fieldsMetadata[field].relation] || [])
                      .concat(Array.isArray(record[field]) ? [record[field][0]] : [])
                  }
                  record[field + '___NODE'] = Array.isArray(record[field])
                    ? createNodeId(`${getGatsbyModelName(allModels, fieldsMetadata[field])}-${record[field][0]}-${lang}`)
                    : null
                  delete record[field]
                  break
              }
            }
            if (model === garbageModel) {
              for (const innerModel of allModels) {
                if (record.model_name === innerModel.odooModelName) {
                  reporter.info(`Deleting node ${innerModel.gatsbyModelName} ${record.id} ${lang}`)
                  deleteNode(getNode(createNodeId(`${innerModel.gatsbyModelName}-${record.model_id}-${lang}`)))
                  break
                }
              }
            }
            reporter.info(`Creating or updating node ${model.gatsbyModelName} ${record.id} ${lang}`)
            const nodeId = createNodeId(`${model.gatsbyModelName}-${record.id}-${lang}`)
            let contentDigest = null
            if (hasForceIds) {
              const existingNode = getNode(nodeId)
              if (existingNode) {
                contentDigest = existingNode.internal.contentDigest
              }
            }
            createNode({
              ...record,
              id_odoo: record.id,
              lang: lang.toLowerCase().replace(new RegExp('_', 'g'), '-'),
              id: nodeId,
              parent: null,
              children: [],
              internal: {
                type: model.gatsbyModelName,
                content: JSON.stringify(record),
                contentDigest: contentDigest ? createContentDigest(contentDigest) : createContentDigest(record),
              },
            })
          })
        }
        offset += limit
      } while (recordIds.length === limit && !hasForceIds)
    }
  }
  return {relatedIdsByModelConnections}
}

exports.sourceNodes = async (params, options) => {

  const {relatedIdsByModelConnections: forceIdsByModelConnections} = await sourceNodes(params, options)
  await sourceNodes(params, options, {forceIdsOnly: true, forceIdsByModelConnections})
}

/**
 * @param createTypes
 * @param cache
 * @param buildObjectType
 * @param {object[]} connections
 * @param {object[]} connections.models
 * @param {object} connections.garbageModel
 * @returns {Promise<void>}
 */
exports.createSchemaCustomization = async ({actions: {createTypes}, cache, schema: {buildObjectType}},
                                           {connections}) => {
  const fieldsMetadataByModelConnections = await cache.get('fieldsMetadataByModelConnections')

  for (const [connectionId, {models, garbageModel}] of connections.entries()) {

    const typeDefinitions = []
    const allModels = models.concat(garbageModel ? [garbageModel] : [])

    for (const model of allModels) {

      const fieldsMetadata = fieldsMetadataByModelConnections[connectionId][model.odooModelName]
      const fields = {id: 'ID!', id_odoo: 'Int!', lang: 'String!', write_date: 'Date!'}

      for (const [field, attributes] of Object.entries({...model.odooFields, ...model.extraFields})) {

        if (Object.keys(fields).includes(field)) {
          // Reserved Names
          continue
        }
        let internalField = field
        //
        // Odoo Types
        //
        if (field in fieldsMetadata) {
          switch (fieldsMetadata[field].type) {
            case 'char':
            case 'html':
            case 'text':
              fields[internalField] = {};
              fields[internalField].type = 'String'
              if (fieldsMetadata[field].required) {
                fields[internalField].type += '!'
              }
              break
            case 'datetime':
              fields[internalField] = {};
              fields[internalField].type = 'Date'
              if (fieldsMetadata[field].required) {
                fields[internalField].type += '!'
              }
              break
            case 'integer':
              fields[internalField] = {};
              fields[internalField].type = 'Int'
              if (fieldsMetadata[field].required) {
                fields[internalField].type += '!'
              }
              break
            case 'many2many':
              internalField = field + '___NODE'
              fields[internalField] = {}
              fields[internalField].type = '['
              fields[internalField].type += getGatsbyModelName(allModels, fieldsMetadata[field])
              // if (fieldsMetadata[field].required) {
              fields[internalField].type += '!'
              // }
              fields[internalField].type += ']!'
              break
            case 'many2one':
              internalField = field + '___NODE'
              fields[internalField] = {}
              fields[internalField].type = getGatsbyModelName(allModels, fieldsMetadata[field])
              if (fieldsMetadata[field].required) {
                fields[internalField].type += '!'
              }
              break
            default:
              throw Error("Missing type: " + fieldsMetadata[field].type)
          }
        } else {
          fields[internalField] = {};
        }
        //
        // Gatsby Config
        //
        ['type', 'resolve']
          .filter(attribute => attribute in attributes)
          .forEach(attribute => fields[internalField][attribute] = attributes[attribute]);
        ['extensions']
          .filter(attribute => attribute in attributes)
          .forEach(attribute => fields[internalField][attribute] = {...(fields[internalField][attribute] || {}), ...attributes[attribute]});
      }
      typeDefinitions.push(buildObjectType({
        name: model.gatsbyModelName,
        interfaces: ["Node"],
        fields,
      }))
    }
    createTypes(typeDefinitions)
  }
}

/**
 * @param {{
 * forbidden: function,
 * string: function,
 * arity: function,
 * maxArity: function,
 * any: function,
 * array: function,
 * number: function,
 * boolean: function,
 * object: function,
 * function: function,
 * }} Joi
 * @returns {*}
 */
exports.pluginOptionsSchema = ({Joi}) => {

  const forbiddenFields = {
    id: Joi.forbidden(),
    id_odoo: Joi.forbidden(),
    lang: Joi.forbidden(),
    write_date: Joi.forbidden(),
  }
  const commonFields = {
    extensions: Joi.object().description("Type definitions extensions."),
  }
  const commonAttributes = {
    ...commonFields,
    type: Joi.string().description("Schema type."),
    resolve: Joi.function().maxArity(4).description("Function to resolve a value."),
    default: Joi.any().description("Default value."),
    change: Joi.function().arity(1).description("Function to change value."),
  }
  const modelSchema = Joi.object({
    odooModelName: Joi.string().required().description("Odoo model name."),
    gatsbyModelName: Joi.string().required().description("Gatsby model name."),
    odooFields: Joi.object(forbiddenFields).pattern(/^/, Joi.object(commonAttributes)).default({}).description("Odoo field definition."),
    extraFields: Joi.object(forbiddenFields).pattern(/^/, Joi.object({
      ...commonFields,
      type: Joi.string().required().description("Schema type."),
      resolve: Joi.function().required().maxArity(4).description("Function to resolve a value."),
    })).default({}).description("Extra field definition."),
    odooDomain: Joi.array().items(
      Joi.string(),
      Joi.array().length(3).ordered(Joi.string().required(), Joi.string().required()).items(Joi.string(), Joi.number(), Joi.boolean()),
    ).default([]).description("Odoo domain."),
  })

  return Joi.object({
    connections: Joi.array().items(Joi.object({
      url: Joi.string().required().description(`Odoo URL, e.g. https://odoo.example.com.`),
      database: Joi.string().required().description(`Odoo database.`),
      username: Joi.string().required().description(`Odoo username.`),
      password: Joi.string().required().description(`Odoo password.`),
      models: Joi.array().items(modelSchema).unique('odooModelName').unique('gatsbyModelName').required(),
      garbageModel: modelSchema.append({
        odooFields: Joi.object({
          model_id: Joi.object(commonAttributes).required(),
          model_name: Joi.object(commonAttributes).required(),
        }).required(),
      }),
    }))
      .unique((a, b) => a.url === b.url && a.database === b.database && a.username === b.username)
      .unique((a, b) => {
          const [aGatsbyNames, bGatsbyNames] = [a, b]
            .map(item => item.models
              .map(model => model.gatsbyModelName)
              .concat(item.garbageModel ? [item.garbageModel.gatsbyModelName] : []))
          const [aOdooNames, bOdooNames] = [a, b]
            .map(item => item.models
              .map(model => model.odooModelName)
              .concat(item.garbageModel ? [item.garbageModel.odooModelName] : []))
          return [aGatsbyNames, bGatsbyNames]
              .map(names => (new Set(names)).size !== names.length)
              .some(Boolean)
            || [aOdooNames, bOdooNames]
              .map(names => (new Set(names)).size !== names.length)
              .some(Boolean)
            || ((new Set([...aGatsbyNames, ...bGatsbyNames])).size !== [...aGatsbyNames, ...bGatsbyNames].length)
        }
      )
  })
}

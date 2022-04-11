const Odoots = require("odoots").default;

/**
 * @param {string} url
 * @param {string} database
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Odoots>}
 */
async function getOdooClient(url, database, username, password) {

  const odoo = new Odoots(url, database)
  await odoo.login(username, password)
  return odoo
}

module.exports.getOdooClient = getOdooClient

class OdooData {

  /** @type {Odoots | null} */
  client = null
  /** @type {Odoots[]} */
  clientConnections = []
  // /** @type {string | null} */
  // data_dir = null
  languages = []
  /** @type {string[][]} */
  languagesConnections = []

  /**
   * @param {string} url
   * @param {string} database
   * @param {string} username
   * @param {string} password
   * @returns {Promise<void>}
   */
  async init(url, database, username, password) {

    this.client = await getOdooClient(url, database, username, password)
    await this.get_languages_from_odoo()
  }

  async get_languages_from_odoo() {

    this.languages = (await this.client.call(
      'res.lang',
      'search_read',
      [[['active', '=', 'True']], ['id', 'code']],
    ))
      .map(record => record.code)
    return this.languages
  }
}

module.exports.odooData = new OdooData()

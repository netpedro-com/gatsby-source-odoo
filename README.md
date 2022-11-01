# gatsby-source-odoo

This project is a Gatsby source plugin used to fetch Odoo data into your Gatsby application.

## Installation

```shell
npm install gatsby-source-odoo
```

## Usage

```javascript
//
// In your gatsby-config.js
//
module.exports = {
  plugins: [
    {
      // This plugin was designed to be declared only once (but accept as many connections as you want).
      // Don't declare it more than once, otherwise bad things can happen (this can be easily improved).
      resolve: 'gatsby-source-odoo',
      options: {
        connections: [
          // Here you can declare as many connections as you want.
          {
            url: process.env.ODOO_URL,
            database: process.env.ODOO_DB,
            username: process.env.ODOO_USER,
            password: process.env.ODOO_PASS,
            models: [
              {
                odooModelName: 'addon_foo.tag',
                gatsbyModelName: 'AddonFooTag',
                odooFields: {
                  // There is no need to declare field types, because this plugin infers automatically!
                  'title': {},
                  'content': {
                    // Optionally change or transform the value right after Odoo data fetching.
                    // Very useful to enforce type consistency.
                    change: (value) => value || '',
                  },
                  'slug': {},
                  // Automatic post relationship.
                  'post_ids': {},
                  'create_date_time': {
                    // This ensures a default value when fetched Odoo data is a boolean "False" (Odoo annoyances).
                    // Very useful to enforce type consistency. This is a shortcut for the "change" option.
                    default: '',
                  },
                },
                odooDomain: [['post_ids.website_ids.name', '=', 'www.example.com']],
              },
              {
                odooModelName: 'addon_foo.post',
                gatsbyModelName: 'AddonFooPost',
                odooFields: {
                  'title': {},
                  'content': {},
                  'slug': {},
                  // Automatic tag relationship.
                  'tag_ids': {},
                  'publish_date_time': {},
                },
                odooDomain: [['website_ids.name', '=', 'www.example.com']],
                // Optionally declare additional fields to be added into Gatsby model.
                extraFields: {
                  image_sources: {
                    type: '[String!]!',
                    // The "source" object gives you access to any Odoo field declared previously.
                    resolve: source => getImageSources(source.content),
                  },
                  video_sources: {
                    type: '[String!]!',
                    resolve: source => getVideoSources(source.content),
                  },
                  short_content: {
                    type: 'String!',
                    resolve: source => getShortContent(source.content),
                  },
                },
              },
            ],
            // Optionally declare a "Garbage Model" to clean Gatsby nodes when it gets deleted on Odoo.
            // Ensure that this model has two fields "model_id" and "model_name".
            garbageModel: {
              odooModelName: 'addon_foo.garbage',
              gatsbyModelName: 'AddonFooGarbage',
              odooFields: {
                'model_id': {},
                'model_name': {},
              },
            },
          },
        ],
      },
    },
  ],
}
```

## Features

  - Allows multiple connections from multiple Odoo instances.
  - Automatic field type inference.
  - Automatic `many2many` and `many2one` relations (missing `one2many` implementation because I never needed it).
  - Allows value transformation and customized extra fields.
  - Incremental data update: once it fetches all Odoo records, successive calls only fetches modified data.
  - Optional garbage collector: ensures data deleted on Odoo gets deleted on Gatsby.
  - Multi-language support: automatically detects installed Odoo languages, and fetch records for each language. 

## Contribution

Any contribution are welcome.

## License

See [LICENSE](LICENSE.md) (MIT).

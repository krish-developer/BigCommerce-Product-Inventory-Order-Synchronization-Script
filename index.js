const csv = require('csvtojson');
const axios = require('axios');

// Path to CSV to be imported
const CSV_FILE_PATH = './orders.csv';

// BigCommerce store credentials
const { BIGCOMMERCE_STORE_HASH, BIGCOMMERCE_ACCESS_TOKEN } = process.env;

// Custom note or tag to add to each imported order
const ORDER_NOTE = 'IMPORTED ORDER';
const ORDER_TAG = 'IMPORTED';

(async () => {
  // Import orders from CSV
  await importOrdersFromCSV(CSV_FILE_PATH);

  // Import orders from Third-Party API
  const thirdPartyApiUrl = 'https://example.com/api/orders';
  await importOrdersFromAPI(thirdPartyApiUrl);

  // Sync products
  const productsCsvPath = './products.csv';
  await syncProducts(productsCsvPath);

  // Sync inventory
  const inventoryCsvPath = './inventory.csv';
  await syncInventory(inventoryCsvPath);
})();

async function importOrdersFromCSV(filePath) {
  try {
    const records = await csv().fromFile(filePath);

    if (!records || records.length === 0) {
      throw new Error(`Couldn't read records from CSV ${filePath}`);
    }

    console.log(`Read ${records.length} records from CSV ${filePath}`);

    const orders = processRecords(records);

    await uploadOrdersToBigCommerce(orders);
  } catch (error) {
    console.error('Error during CSV order processing:', error.message);
  }
}

async function importOrdersFromAPI(apiUrl) {
  try {
    const { data: records } = await axios.get(apiUrl);

    if (!records || records.length === 0) {
      throw new Error(`No records retrieved from API ${apiUrl}`);
    }

    console.log(`Retrieved ${records.length} records from API ${apiUrl}`);

    const orders = processRecords(records);

    await uploadOrdersToBigCommerce(orders);
  } catch (error) {
    console.error('Error during API order processing:', error.message);
  }
}

function processRecords(records) {
  const orders = {};

  records.forEach(record => {
    const orderName = record.email.replace(/[^\w]+/g, '_');

    if (!orders[orderName]) {
      orders[orderName] = {
        imported: false,
        order_name: orderName,
        email: record.email,
        phone: record.phone,
        billing_name: record.billing_name,
        billing_company: record.company,
        billing_address1: record.billing_address1,
        billing_address2: record.billing_address2 || null,
        billing_city: record.billing_city,
        billing_zip: record.billing_zip,
        billing_province: record.billing_province && record.billing_province.length === 2 ?
          record.billing_province : null,
        billing_country: record.billing_country,
        line_items: [
          {
            name: record.lineitem_title,
            sku: record.lineitem_sku,
            price_inc_tax: 0.00,
            quantity: parseInt(record.lineitem_quantity)
          }
        ],
        shipping_method: record.shipping_method,
        order_is_digital: false,
        tags: ORDER_TAG,
        customer_message: record.note_attributes || ''
      };
    } else {
      orders[orderName].line_items.push({
        name: record.lineitem_title,
        sku: record.lineitem_sku,
        price_inc_tax: 0.00,
        quantity: parseInt(record.lineitem_quantity)
      });
    }
  });

  return Object.values(orders).filter(order => !order.imported);
}

async function uploadOrdersToBigCommerce(ordersArr) {
  for (let i = 0; i < ordersArr.length; i++) {
    const order = ordersArr[i];
    console.log(`Uploading order ${i + 1}/${ordersArr.length} to BigCommerce`);

    const billing_address = {
      first_name: order.billing_name.split(' ')[0],
      last_name: order.billing_name.split(' ').slice(1).join(' '),
      address1: order.billing_address1,
      address2: order.billing_address2,
      city: order.billing_city,
      state: order.billing_province,
      zip: order.billing_zip,
      country: order.billing_country,
      phone: order.phone,
    };

    const bigCommerceOrder = {
      customer_id: 0,
      status_id: 11, // Set to 'Pending' (ID 11)
      billing_address,
      shipping_addresses: [billing_address],
      products: order.line_items,
      shipping_cost_inc_tax: 0.00,
      base_shipping_cost: 0.00,
      customer_message: order.customer_message,
      staff_notes: ORDER_NOTE,
    };

    try {
      const result = await uploadOrderToBigCommerce(bigCommerceOrder);
      console.log(`Uploaded order ${i + 1}/${ordersArr.length} to BigCommerce: ${result.id}`);
    } catch (error) {
      console.error(`Failed to upload order ${i + 1}/${ordersArr.length}:`, error.response?.data || error.message);
    }

    await sleep(1000); // To avoid hitting API rate limits
  }
}

async function uploadOrderToBigCommerce(order) {
  const url = `https://api.bigcommerce.com/stores/${BIGCOMMERCE_STORE_HASH}/v2/orders`;

  const config = {
    method: 'POST',
    url,
    headers: {
      'X-Auth-Token': BIGCOMMERCE_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    },
    data: order
  };

  const response = await axios(config);
  return response.data;
}

async function syncProducts(filePath) {
  try {
    const records = await csv().fromFile(filePath);

    if (!records || records.length === 0) {
      throw new Error(`Couldn't read records from CSV ${filePath}`);
    }

    console.log(`Read ${records.length} product records from CSV ${filePath}`);

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      console.log(`Syncing product ${i + 1}/${records.length}`);

      const productData = {
        name: record.name,
        sku: record.sku,
        price: parseFloat(record.price),
        categories: [parseInt(record.category_id)],
        type: record.type || 'physical',
        inventory_level: parseInt(record.inventory_level),
        inventory_warning_level: parseInt(record.inventory_warning_level),
        is_visible: record.is_visible === 'true'
      };

      try {
        const result = await uploadProductToBigCommerce(productData);
        console.log(`Synced product ${i + 1}/${records.length}: ${result.id}`);
      } catch (error) {
        console.error(`Failed to sync product ${i + 1}/${records.length}:`, error.response?.data || error.message);
      }

      await sleep(500); // To avoid hitting API rate limits
    }
  } catch (error) {
    console.error('Error during product sync:', error.message);
  }
}

async function uploadProductToBigCommerce(product) {
  const url = `https://api.bigcommerce.com/stores/${BIGCOMMERCE_STORE_HASH}/v3/catalog/products`;

  const config = {
    method: 'POST',
    url,
    headers: {
      'X-Auth-Token': BIGCOMMERCE_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    },
    data: product
  };

  const response = await axios(config);
  return response.data.data;
}

async function syncInventory(filePath) {
  try {
    const records = await csv().fromFile(filePath);

    if (!records || records.length === 0) {
      throw new Error(`Couldn't read records from CSV ${filePath}`);
    }

    console.log(`Read ${records.length} inventory records from CSV ${filePath}`);

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      console.log(`Syncing inventory ${i + 1}/${records.length}`);

      const inventoryData = {
        inventory_level: parseInt(record.inventory_level),
        inventory_warning_level: parseInt(record.inventory_warning_level)
      };

      try {
        const result = await updateInventoryInBigCommerce(record.sku, inventoryData);
        console.log(`Synced inventory for product ${i + 1}/${records.length}: ${result}`);
      } catch (error) {
        console.error(`Failed to sync inventory ${i + 1}/${records.length}:`, error.response?.data || error.message);
      }

      await sleep(500); // To avoid hitting API rate limits
    }
  } catch (error) {
    console.error('Error during inventory sync:', error.message);
  }
}

async function updateInventoryInBigCommerce(sku, inventoryData) {
  const url = `https://api.bigcommerce.com/stores/${BIGCOMMERCE_STORE_HASH}/v3/catalog/products?sku=${sku}`;

  const config = {
    method: 'PUT',
    url,
    headers: {
      'X-Auth-Token': BIGCOMMERCE_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    },
    data: inventoryData
  };

  const response = await axios(config);
  return response.data.data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

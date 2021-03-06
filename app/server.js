const http = require('http');
const fs = require('fs');
const finalHandler = require('finalhandler');
const queryString = require('querystring');
const Router = require('router');
const bodyParser = require('body-parser');
const url = require('url')
const uid = require('rand-token').uid;
const TOKEN_VALIDITY_TIMEOUT = 15 * 60 * 1000;

const PORT = 3001;
// State holding variables
let brands = [];
let products = [];
let users = [];
let tokens = [];
let currentUser;

// Helper method to process access token
var getValidTokenFromRequest = function (req) {
  var parsedUrl = require('url').parse(req.url, true);
  if (parsedUrl.query.accessToken) {
    // Verify the access token to make sure it's valid and not expired
    let currentAccessToken = tokens.find(accessToken => {
      return accessToken.token == parsedUrl.query.accessToken && ((new Date) - accessToken.lastUpdated) < TOKEN_VALIDITY_TIMEOUT;
    });
    if (currentAccessToken) {
      return currentAccessToken;
    } else {
      return null;
    }
  } else {
    return null;
  }
};

// Router setup
const router = Router();
router.use(bodyParser.json());

// Declare server to export for testing
const server = http.createServer(function (request, response) {

  router(request, response, finalHandler(request, response));

}).listen(PORT, error => {
  if (error) {
    return console.log("Error on Server Startup: ", error);
  }
  // Load initial brands
  fs.readFile("./initial-data/brands.json", "utf8", (error, data) => {
    if (error) throw error;
    brands = JSON.parse(data);
    console.log(`Server setup: ${brands.length} brands loaded`);
  });
  // Load initial products
  fs.readFile("./initial-data/products.json", "utf8", (error, data) => {
    if (error) throw error;
    products = JSON.parse(data);
    console.log(`Server setup: ${products.length} products loaded`);
  });
  // Load initial users
  fs.readFile("./initial-data/users.json", "utf8", (error, data) => {
    if (error) throw error;
    users = JSON.parse(data);
    console.log(`Server setup: ${users.length} users loaded`);
  });
  console.log(`Server is listening on ${PORT}`);
});

router.get("/api/brands", (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json'
  })
  // Return all brands
  res.end(JSON.stringify(brands))
})

router.get('/api/brands/:id/products', (req, res) => {
  // Return only matching products from given brand
  let productsInBrand = products.filter((product) => {
    return product.brandId === req.params.id
  })

  // Return 404 if no products found(brand doesn't exist)
  if (productsInBrand.length === 0) {
    res.writeHead(404, {
      'Content-Type': "text/plain"
    })
    return res.end("404 Error: Brand ID not found.")
  }

  res.writeHead(200, {
    'Content-Type': 'application/json'
  })
  res.end(JSON.stringify(productsInBrand));
})

router.get("/api/products", (req, res) => {
  // Get our query params from the query string
  const queryParams = queryString.parse(url.parse(req.url).query)

  if (queryParams.query) {
    // Saves query value
    const searchQuery = queryParams.query;

    // Return only products matching name from searchQuery
    const matchingProducts = products.filter(product => {
      return (
        product.name.toUpperCase().includes(searchQuery.toUpperCase()) ||
        product.description.toUpperCase().includes(searchQuery.toUpperCase())
      )
    })

    // Return 404 if no products found
    if (matchingProducts.length === 0) {
      res.writeHead(404, {
        'Content-Type': "text/plain"
      })
      return res.end("404 Error: No products found.")
    }

    // Return all matching products
    res.writeHead(200, {
      'Content-Type': 'application/json'
    })
    return res.end(JSON.stringify(matchingProducts));
  }

  // Returns all products if no query given
  else {
    res.writeHead(200, {
      'Content-Type': 'application/json'
    })
    return res.end(JSON.stringify(products))
  }
})

router.post("/api/login", (req, res) => {
  let emailReq = req.body.email
  let passwordReq = req.body.password
  currentUser = (users.find(user => (user.email == emailReq) && (user.login.password === passwordReq)))

  // Make sure there is a email and password in the request
  if (!emailReq || !passwordReq) {
    res.writeHead(400, {
      'Content-Type': "text/plain"
    });
    res.end("400 Error: Email & Password must not be empty");
  }

  // If no user found matching given credentials, return error
  if (!currentUser) {
    res.writeHead(401, {
      'Content-Type': "text/plain"
    })
    res.end("401 Error: username and/or password incorrect")
  }

  // Login is succesful - can return 200.
  res.writeHead(200, {
    'Content-Type': 'application/json'
  })

  // We have a successful login, if we already have an existing access token, use that
  let currentAccessToken = tokens.find((tokenItem) => {
    return tokenItem.username == currentUser.login.username;
  });
  // Update the last updated value so we get another time period
  if (currentAccessToken) {
    currentAccessToken.lastUpdated = new Date();
    return res.end(JSON.stringify(currentAccessToken.token));
  } else {
    // Create a new token with the user value and a "random" token
    let newAccessToken = {
      username: currentUser.login.username,
      lastUpdated: new Date(),
      token: uid(16)
    }
    tokens.push(newAccessToken);
    return res.end(JSON.stringify(newAccessToken.token));
  }
})

// Return cart of current user
router.get("/api/me/cart", (req, res) => {
  let currentAccessToken = getValidTokenFromRequest(req);
  if (!currentAccessToken) {
    // If there isn't an access token in the request, we know that the user isn't logged in, so don't continue
    res.writeHead(401, {
      'Content-Type': "text/plain"
    });
    return res.end("401 error: Must be logged in with validated access token to access cart");
  }

  res.writeHead(200, {
    'Content-Type': 'application/json'
  })
  // Return all products in user's cart
  res.end(JSON.stringify(currentUser.cart))
})

router.post("/api/me/cart", (req, res) => {
  let currentAccessToken = getValidTokenFromRequest(req);
  if (!currentAccessToken) {
    // If there isn't an access token in the request, we know that the user isn't logged in, so don't continue
    res.writeHead(401, {
      'Content-Type': "text/plain"
    });
    return res.end("401 error: Must be logged in with validated access token to access cart");
  }

  // product to add to cart
  let productObj = req.body

  // Respond with error if properties missing from product
  if (!productObj.price || !productObj.id || !productObj.brandId || !productObj.name || !productObj.description) {
    res.writeHead(400, {
      'Content-Type': 'application/json'
    });
    return res.end(JSON.stringify(productObj));
  }

  if (productObj.price < 0) {
    res.writeHead(400, {
      'Content-Type': 'application/json'
    });
    return res.end(JSON.stringify(productObj));
  }

    res.writeHead(200, {
    'Content-Type': 'application/json'
  })

  // Checks if added product is already in cart
  const productInCart = currentUser.cart.find(product => {
    return productObj.id == product.id
  })

  // Adds 1 to quantity if added producted already in cart, otherwise default to 1
  if (productInCart) {
    productInCart.quantity += 1;
    return res.end(JSON.stringify(productInCart))
  } else {
    // Create quantity property for products in cart
    productObj.quantity = 1;
    currentUser.cart.push(productObj)
    return res.end(JSON.stringify(productObj))
  }
})

router.delete("/api/me/cart/:id", (req, res) => {
  let currentAccessToken = getValidTokenFromRequest(req);
  if (!currentAccessToken) {
    // If there isn't an access token in the request, we know that the user isn't logged in, so don't continue
    res.writeHead(401, {
      'Content-Type': "text/plain"
    });
    return res.end("401 error: Must be logged in with validated access token to access cart");
  }

  // Product ID to remove from cart
  let productToRemove = req.params.id

  // Check if product found in cart
  let productInCart = currentUser.cart.find(product => {
    return productToRemove == product.id;
  })

  if (!productInCart) {
    res.writeHead(404, {
      'Content-Type': "text/plain"
    });
    return res.end("404: Requested product to delete not found in cart");
  }

  // New cart returned without the 'deleted' product. Assigned to current user cart.
  let cartAfterProductRemove = currentUser.cart.filter(cartItemObj => {
    cartItemObj.id != productToRemove
  })
  currentUser.cart = cartAfterProductRemove

  res.writeHead(200, {
    'Content-Type': 'application/json'
  })

  // Return new cart after DELETE product
  res.end(JSON.stringify(currentUser.cart))
})

router.post("/api/me/cart/:id", (req, res) => {
  let currentAccessToken = getValidTokenFromRequest(req);
  if (!currentAccessToken) {
    // If there isn't an access token in the request, we know that the user isn't logged in, so don't continue
    res.writeHead(401, {
      'Content-Type': "text/plain"
    });
    return res.end("401 error: Must be logged in with validated access token to access cart");
  }

  const newQuantity = parseInt(req.body.quantity);
  // Checks if quantity sent is valid number
  if (newQuantity < 1) {
    res.writeHead(400, {
      'Content-Type': "text/plain"
    });
    return res.end("400 error: cannot set quantity of product to negative number");
  } else if (newQuantity > 30) {
    res.writeHead(400, {
      'Content-Type': "text/plain"
    });
    return res.end("400 error: cannot set quantity of product to more than 30");
  }

    // Product ID to update in cart
  let productToUpdate = req.params.id;

  // Check if product found in cart and returns index
  let productIndex = currentUser.cart.findIndex(product => {
    return productToUpdate == product.id;
  })

  // If no product found, return error
  if (productIndex === -1) {
    res.writeHead(404, {
      'Content-Type': "text/plain"
    });
    return res.end("404: Requested product to change quantity not found in cart");
  } 

  // Set new quantity of specified product
  currentUser.cart[productIndex].quantity = newQuantity;

  res.writeHead(200, {
    'Content-Type': 'application/json'
  })

  res.end(JSON.stringify(currentUser.cart[productIndex]))
})

// allow for testing
module.exports = server;
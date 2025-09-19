// src/pages/product.js
import { ensureLayout, requireAuth, toast } from '../core.js';
import { doc, getDoc, collection, query, where, getDocs, runTransaction, FieldValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

(async function() {
  await ensureLayout('product.html');

  const urlParams = new URLSearchParams(window.location.search);
  const productId = urlParams.get('id');

  if (!productId) {
    toast('상품 ID를 찾을 수 없습니다.');
    window.location.href = '/index.html';
    return;
  }

  const db = firebase.firestore();
  const auth = firebase.auth();

  const productDetailsContainer = document.getElementById('product-details');
  const ratingDisplay = document.getElementById('rating-display');
  const starRatingContainer = document.getElementById('star-rating');
  const submitRatingBtn = document.getElementById('submit-rating');
  const stars = starRatingContainer ? starRatingContainer.querySelectorAll('.star') : [];

  let selectedRating = 0;
  let currentProduct = null;

  const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // Function to render product details (Safest version)
  const renderProductDetails = (product) => {
    currentProduct = product;
    // Clear previous content
    productDetailsContainer.innerHTML = '';

    // Create elements programmatically
    const row = document.createElement('div');
    row.className = 'row';

    const colImg = document.createElement('div');
    colImg.className = 'col-md-6';
    const img = document.createElement('img');
    img.src = product.imageUrl || 'https://placehold.co/400';
    img.className = 'img-fluid';
    img.alt = product.name || 'Product Image';
    colImg.appendChild(img);

    const colDetails = document.createElement('div');
    colDetails.className = 'col-md-6';

    const nameH2 = document.createElement('h2');
    nameH2.textContent = product.name || '[상품명 없음]';

    const priceP = document.createElement('p');
    priceP.innerHTML = `<strong>가격:</strong> ${product.price || 0}paw`;

    const descDiv = document.createElement('div');
    const descTitle = document.createElement('strong');
    descTitle.textContent = '설명:';
    const descContent = document.createElement('div');
    descContent.className = 'product-description-html';
    // Safely set as plain text
    descContent.textContent = product.description || '';
    descDiv.appendChild(descTitle);
    descDiv.appendChild(descContent);

    const ratingP = document.createElement('p');
    ratingP.innerHTML = `<strong>평균 평점:</strong> <span id="avg-rating">${product.avgRating ? product.avgRating.toFixed(1) : 'N/A'}</span> (${product.numRatings || 0}명 참여)`;

    colDetails.appendChild(nameH2);
    colDetails.appendChild(priceP);
    colDetails.appendChild(descDiv);
    colDetails.appendChild(ratingP);

    row.appendChild(colImg);
    row.appendChild(colDetails);

    productDetailsContainer.appendChild(row);

    displayAverageRating(product.avgRating, product.numRatings);
  };

  // Function to display average rating
  const displayAverageRating = (avgRating, numRatings) => {
    if (ratingDisplay) {
      ratingDisplay.innerHTML = `현재 평균 평점: <strong>${avgRating ? avgRating.toFixed(1) : 'N/A'}</strong> (${numRatings || 0}명 참여)`;
    }
  };

  // Fetch product details and ratings
  const fetchProductAndRatings = async () => {
    try {
      const productRef = db.collection('products').doc(productId);
      const productSnap = await productRef.get();

      if (productSnap.exists) {
        const productData = { id: productSnap.id, ...productSnap.data() };
        renderProductDetails(productData);

        const user = auth.currentUser;
        if (user) {
          const userRatingRef = productRef.collection('ratings').doc(user.uid);
          const userRatingSnap = await userRatingRef.get();
          if (userRatingSnap.exists) {
            selectedRating = userRatingSnap.data().rating;
            stars.forEach((star, i) => {
              star.style.color = i < selectedRating ? 'gold' : 'gray';
            });
            if (ratingDisplay) {
              ratingDisplay.textContent = `선택 평점: ${selectedRating}점`;
            }
          }
        }
      } else {
        toast('상품을 찾을 수 없습니다.');
        window.location.href = '/index.html';
      }
    } catch (error) {
      console.error('[product] Error fetching product:', error);
      toast('상품 정보를 불러오는 중 오류가 발생했습니다.');
    }
  };

  await fetchProductAndRatings();

  // Star hover and click effects
  if (starRatingContainer) {
    stars.forEach(star => {
      star.addEventListener('mouseover', () => {
        const value = parseInt(star.dataset.value);
        stars.forEach((s, i) => {
          s.style.color = i < value ? 'gold' : 'gray';
        });
      });

      star.addEventListener('mouseout', () => {
        stars.forEach((s, i) => {
          s.style.color = i < selectedRating ? 'gold' : 'gray';
        });
      });

      star.addEventListener('click', () => {
        selectedRating = parseInt(star.dataset.value);
        stars.forEach((s, i) => {
          s.style.color = i < selectedRating ? 'gold' : 'gray';
        });
        if (ratingDisplay) {
          ratingDisplay.textContent = `선택 평점: ${selectedRating}점`;
        }
      });
    });
  }

  // Submit rating
  if (submitRatingBtn) {
    submitRatingBtn.addEventListener('click', async () => {
      if (selectedRating === 0) {
        toast('평점을 선택해주세요.');
        return;
      }
      if (!productId) {
        toast('상품 ID를 찾을 수 없습니다.');
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        toast('로그인 후 평점을 남길 수 있습니다.');
        // Optionally redirect to login page
        return;
      }

      try {
        await db.runTransaction(async (transaction) => {
          const productRef = db.collection('products').doc(productId);
          const productDoc = await transaction.get(productRef);

          if (!productDoc.exists) {
            throw new Error('상품을 찾을 수 없습니다.');
          }

          const currentAvgRating = productDoc.data().avgRating || 0;
          const currentNumRatings = productDoc.data().numRatings || 0;

          // Check if user has already rated this product
          const userRatingRef = productRef.collection('ratings').doc(user.uid);
          const userRatingSnap = await transaction.get(userRatingRef);

          let newNumRatings = currentNumRatings;
          let newTotalRating = currentAvgRating * currentNumRatings;

          if (userRatingSnap.exists) {
            // User has rated before, update existing rating
            const oldRating = userRatingSnap.data().rating;
            newTotalRating = newTotalRating - oldRating + selectedRating;
          } else {
            // New rating from this user
            newNumRatings = currentNumRatings + 1;
            newTotalRating = newTotalRating + selectedRating;
          }

          const newAvgRating = newTotalRating / newNumRatings;

          transaction.update(productRef, {
            avgRating: newAvgRating,
            numRatings: newNumRatings
          });
          transaction.set(userRatingRef, { rating: selectedRating, userId: user.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
        });
        toast('평점이 성공적으로 제출되었습니다!');
        await fetchProductAndRatings(); // Re-fetch to update average rating display
      } catch (error) {
        console.error('평점 제출 오류:', error);
        toast(`평점 제출에 실패했습니다: ${error.message}`);
      }
    });
  }
})();

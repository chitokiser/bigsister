import { ensureLayout, requireAuth, toast } from '../core.js';
import { doc, getDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

(async function() {
  await ensureLayout('edit-product.html');
  const user = await requireAuth('index.html');

  const urlParams = new URLSearchParams(window.location.search);
  const productId = urlParams.get('id');

  // Existing product editing elements
  const productNameInput = document.getElementById('product-name');
  const productDescriptionInput = document.getElementById('product-description');
  const productPriceInput = document.getElementById('product-price');
  const productImageInput = document.getElementById('product-image');
  const currentProductImage = document.getElementById('current-product-image');
  const editProductForm = document.getElementById('edit-product-form');
  const deleteProductBtn = document.getElementById('delete-product-btn');

  let productData = null;
  let currentImageUrl = null;

  const db = firebase.firestore();
  const storage = firebase.storage();

  // New voucher creation elements
  const voucherPriceInput = document.getElementById('voucher-price');
  const btnCreateVoucher = document.getElementById('btn-create-voucher');
  const mateStatusMessage = document.getElementById('mate-status-message');

  // Fetch product details (only if productId exists)
  const fetchProduct = async () => {
    if (!productId) return; // If no product ID, it's a new product creation flow

    const productRef = doc(db, 'products', productId);
    const productSnap = await getDoc(productRef);

    if (productSnap.exists()) {
      productData = productSnap.data();
      if (productData.sellerId !== user.uid) {
        toast('You are not authorized to edit this product.');
        window.location.href = '/my.html';
        return;
      }
      productNameInput.value = productData.name;
      productDescriptionInput.value = productData.description;
      productPriceInput.value = productData.price;
      currentImageUrl = productData.imageUrl;
      if (currentImageUrl) {
        currentProductImage.src = currentImageUrl;
        currentProductImage.style.display = 'block';
      }
    } else {
      toast('Product not found.');
      window.location.href = '/my.html';
    }
  };

  await fetchProduct();

  // Handle form submission (existing product update)
  if (editProductForm) {
    editProductForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const newName = productNameInput.value;
      const newDescription = productDescriptionInput.value;
      const newPrice = parseFloat(productPriceInput.value);
      const newImageFile = productImageInput.files[0];

      if (!newName || !newDescription || isNaN(newPrice)) {
        toast('Please fill in all fields correctly.');
        return;
      }

      let imageUrl = currentImageUrl;

      if (newImageFile) {
        const imageRef = ref(storage, `product_images/${productId}/${newImageFile.name}`);
        await uploadBytes(imageRef, newImageFile);
        imageUrl = await getDownloadURL(imageRef);

        if (currentImageUrl && currentImageUrl !== imageUrl) {
          try {
            const oldImageRef = ref(storage, currentImageUrl);
            await deleteObject(oldImageRef);
          } catch (error) {
            console.warn('Could not delete old image:', error.message);
          }
        }
      }

      const productRef = doc(db, 'products', productId);
      await updateDoc(productRef, {
        name: newName,
        description: newDescription,
        price: newPrice,
        imageUrl: imageUrl,
        updatedAt: new Date()
      });

      toast('Product updated successfully!');
      window.location.href = '/my.html';
    });
  }

  // Handle product deletion
  if (deleteProductBtn) {
    deleteProductBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete this product?')) {
        try {
          if (currentImageUrl) {
            const imageRef = ref(storage, currentImageUrl);
            await deleteObject(imageRef);
          }

          const productRef = doc(db, 'products', productId);
          await deleteDoc(productRef);

          toast('Product deleted successfully!');
          window.location.href = '/my.html';
        } catch (error) {
          toast('Error deleting product: ' + error.message);
          console.error('Error deleting product:', error);
        }
      }
    });
  }

  // ===== Web3 Mate Voucher Creation =====
  async function checkMateStatus() {
    mateStatusMessage.textContent = '메이트 상태 확인 중...';
    voucherPriceInput.disabled = true;
    btnCreateVoucher.disabled = true;

    try {
      if (!window.ethereum) {
        mateStatusMessage.textContent = '메타마스크를 설치해주세요.';
        mateStatusMessage.classList.add('alert-danger');
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();

      const pawMateConfig = window.CONFIG.onchain.PawMate;
      if (!pawMateConfig || !pawMateConfig.address || !pawMateConfig.abi) {
        mateStatusMessage.textContent = 'PawMate 컨트랙트 설정이 누락되었습니다. config.js를 확인하세요.';
        mateStatusMessage.classList.add('alert-danger');
        return;
      }

      const pawMateContract = new ethers.Contract(pawMateConfig.address, pawMateConfig.abi, signer);

      // Check if user is a mate
      const isMate = await pawMateContract.mate(userAddress);

      if (isMate) {
        mateStatusMessage.textContent = '메이트입니다. 바우처를 생성할 수 있습니다.';
        mateStatusMessage.classList.remove('alert-info', 'alert-danger');
        mateStatusMessage.classList.add('alert-success');
        voucherPriceInput.disabled = false;
        btnCreateVoucher.disabled = false;
      } else {
        mateStatusMessage.textContent = '메이트가 아닙니다. 바우처를 생성할 수 없습니다.';
        mateStatusMessage.classList.remove('alert-info', 'alert-success');
        mateStatusMessage.classList.add('alert-danger');
      }
    } catch (error) {
      console.error('[edit-product] checkMateStatus error:', error);
      mateStatusMessage.textContent = `메이트 상태 확인 실패: ${error.message || error}`; 
      mateStatusMessage.classList.remove('alert-info', 'alert-success');
      mateStatusMessage.classList.add('alert-danger');
    }
  }

  async function createVoucher() {
    const price = parseFloat(voucherPriceInput.value);

    if (isNaN(price) || price <= 0) {
      toast('유효한 바우처 가격을 입력해주세요.');
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const pawMateConfig = window.CONFIG.onchain.PawMate;
      const pawMateContract = new ethers.Contract(pawMateConfig.address, pawMateConfig.abi, signer);

      toast(`바우처 생성 트랜잭션 전송 중... (가격: ${price})`);
      const tx = await pawMateContract.bcrate(ethers.parseUnits(price.toString(), 18)); // Assuming price is in ether and needs to be converted to wei
      await tx.wait(); // Wait for the transaction to be mined

      toast(`바우처 생성 완료! ID: ${tx.hash}`); // Transaction hash as a temporary ID
      voucherPriceInput.value = ''; // Clear input
    } catch (error) {
      console.error('[edit-product] createVoucher error:', error);
      toast(`바우처 생성 실패: ${error.message || error}`);
    }
  }

  // Event Listeners for new elements
  if (btnCreateVoucher) {
    btnCreateVoucher.addEventListener('click', createVoucher);
  }

  // Initial mate status check on page load
  checkMateStatus();
})();
